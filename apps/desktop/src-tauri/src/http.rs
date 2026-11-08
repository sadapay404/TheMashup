//! Native HTTP bridge.
//!
//! Why this exists: the web build can only reach `music.youtube.com` through a third-party CORS
//! relay, which is the one fragile dependency in the whole architecture (ADR-001). Requests made
//! *from Rust* have no origin, so there is no preflight and no `Access-Control-*` negotiation.
//! The desktop client therefore talks to InnerTube directly.
//!
//! Design rules, mirroring the web transport chain:
//!  - failure is a value (`{ ok: false, error }`), never a panic
//!  - the response body is returned as text so the JS parser stays the single source of truth
//!  - status codes are passed through untouched; the caller's retry policy decides what matters
//!  - a request is always bounded in time, because a hung socket is indistinguishable from a crash

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// A single outbound request, described by the JS transport layer.
#[derive(Debug, Deserialize)]
pub struct HttpRequest {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    /// Milliseconds. Defaults to 20 s: long enough for a search, short enough to fail visibly.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

fn default_method() -> String {
    "GET".to_string()
}

/// The result shape the JS side expects. Never an `Err` across the boundary — that would surface as
/// an unhandled rejection in the renderer.
#[derive(Debug, Serialize)]
pub struct HttpOutcome {
    pub ok: bool,
    pub status: u16,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl HttpOutcome {
    fn failure(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            status: 0,
            body: String::new(),
            error: Some(message.into()),
        }
    }
}

/// Strip hop-by-hop and browser-owned headers that a native client must not send verbatim.
///
/// `Origin`, `Referer`, `Cookie` (browser-managed) and `Content-Length` are all either meaningless
/// or actively harmful when set by hand; leaving them in produces confusing 4xx responses from
/// upstream rather than an honest error.
fn sanitize_headers(headers: HashMap<String, String>) -> HashMap<String, String> {
    const DROP: [&str; 6] = [
        "host",
        "content-length",
        "connection",
        "accept-encoding",
        "origin",
        "referer",
    ];
    headers
        .into_iter()
        .filter(|(k, _)| !DROP.contains(&k.to_ascii_lowercase().as_str()))
        .collect()
}

/// Validate a URL before handing it to the network stack.
///
/// Only http(s) is allowed: this keeps the bridge from being turned into a `file://` reader by a
/// crafted payload from the renderer.
fn validate_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("empty url".to_string());
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") {
        Ok(())
    } else {
        Err(format!("unsupported scheme (only http/https): {trimmed}"))
    }
}

/// Perform the request. Async because Tauri commands are; the work is dominated by I/O.
pub async fn perform(request: HttpRequest) -> HttpOutcome {
    if let Err(e) = validate_url(&request.url) {
        return HttpOutcome::failure(e);
    }

    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(20_000).clamp(1_000, 120_000));

    let client = match reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(10))
        .user_agent(user_agent())
        .build()
    {
        Ok(c) => c,
        Err(e) => return HttpOutcome::failure(format!("client init failed: {e}")),
    };

    let method = match reqwest::Method::from_bytes(request.method.to_uppercase().as_bytes()) {
        Ok(m) => m,
        Err(_) => return HttpOutcome::failure(format!("invalid method: {}", request.method)),
    };

    let mut builder = client.request(method, &request.url);
    for (k, v) in sanitize_headers(request.headers) {
        builder = builder.header(k, v);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    match builder.send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            match response.text().await {
                // `ok` describes the transport, not the HTTP status: a 403 is a successful round
                // trip that the caller must interpret. Conflating the two would hide real errors.
                Ok(body) => HttpOutcome {
                    ok: true,
                    status,
                    body,
                    error: None,
                },
                Err(e) => HttpOutcome::failure(format!("failed reading body: {e}")),
            }
        }
        Err(e) => {
            let kind = if e.is_timeout() {
                "timeout"
            } else if e.is_connect() {
                "connect"
            } else if e.is_request() {
                "request"
            } else {
                "network"
            };
            HttpOutcome::failure(format!("{kind}: {e}"))
        }
    }
}

/// A desktop client should identify itself honestly rather than masquerading as Chrome.
fn user_agent() -> String {
    format!("TheMashup/{} (desktop)", env!("CARGO_PKG_VERSION"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_schemes() {
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("javascript:alert(1)").is_err());
        assert!(validate_url("").is_err());
        assert!(validate_url("  ").is_err());
    }

    #[test]
    fn accepts_http_and_https() {
        assert!(validate_url("https://music.youtube.com/youtubei/v1/search").is_ok());
        assert!(validate_url("http://localhost:5173/").is_ok());
        // Leading whitespace from a copy-paste must not break a valid URL.
        assert!(validate_url("  https://example.test/x  ").is_ok());
    }

    #[test]
    fn drops_forbidden_headers_case_insensitively() {
        let mut headers = HashMap::new();
        headers.insert("Origin".to_string(), "http://evil.test".to_string());
        headers.insert("HOST".to_string(), "wrong.test".to_string());
        headers.insert("content-length".to_string(), "999".to_string());
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        headers.insert("X-Goog-Api-Key".to_string(), "keep-me".to_string());

        let cleaned = sanitize_headers(headers);

        assert!(!cleaned.keys().any(|k| k.eq_ignore_ascii_case("origin")));
        assert!(!cleaned.keys().any(|k| k.eq_ignore_ascii_case("host")));
        assert!(!cleaned.keys().any(|k| k.eq_ignore_ascii_case("content-length")));
        assert_eq!(
            cleaned.get("Content-Type").map(String::as_str),
            Some("application/json")
        );
        assert_eq!(
            cleaned.get("X-Goog-Api-Key").map(String::as_str),
            Some("keep-me")
        );
    }

    #[test]
    fn failure_outcome_is_never_ok() {
        let failure = HttpOutcome::failure("boom");
        assert!(!failure.ok);
        assert_eq!(failure.status, 0);
        assert!(failure.error.is_some());
    }

    #[test]
    fn user_agent_is_identifiable() {
        let ua = user_agent();
        assert!(ua.starts_with("TheMashup/"));
        assert!(ua.contains("desktop"));
    }
}
