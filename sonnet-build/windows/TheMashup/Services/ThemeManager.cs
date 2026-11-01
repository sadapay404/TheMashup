using Avalonia;
using Avalonia.Media;
using Avalonia.Styling;

namespace TheMashup.Services;

public sealed record Palette(
    string Id, string Name, string Tagline, bool Dark,
    string Bg, string Surface, string Raised, string Text, string Muted, string Subtle,
    string Accent, string Accent2, string AccentText, string Outline);

public static class ThemeManager
{
    public static readonly IReadOnlyList<Palette> All = new[]
    {
        new Palette("frosted", "Frosted Glass", "Dark · Glass", true,
            "#0A0A0F", "#15151F", "#1D1D2A", "#F4F4F8", "#A8A8BC", "#74748A", "#9B80FF", "#6C9BFF", "#0B0B12", "#2C2C3B"),
        new Palette("paper", "Paper & Ink", "Light · Typographic", false,
            "#F6F1E7", "#ECE5D6", "#FBF8F1", "#1E1A16", "#5E554A", "#8C8274", "#B3441F", "#7A5C3E", "#FFF8F0", "#D5CAB4"),
        new Palette("neon", "Neon Cyber", "Dark · Electric", true,
            "#070B12", "#1B4742", "#245A54", "#E8FFF9", "#8FC9BE", "#5E9188", "#00DDB0", "#FF3EC8", "#04100D", "#2E6A62"),
        new Palette("aurora", "Aurora", "Dark · Atmospheric", true,
            "#101A36", "#2B3E68", "#36508A", "#EAF2FF", "#A9BCE0", "#7C90B8", "#6EE7FF", "#B490FF", "#06121F", "#44598A"),
        new Palette("vinyl", "Vinyl", "Warm · Retro", true,
            "#221A14", "#48392C", "#574536", "#F7EBDD", "#C9B49C", "#99856F", "#E8A33D", "#BD5959", "#1E1408", "#62503E"),
    };

    public static Palette Get(string id) => All.FirstOrDefault(p => p.Id == id) ?? All[0];

    static IBrush B(string hex) => new SolidColorBrush(Color.Parse(hex));

    /// <summary>Swaps every brush resource; DynamicResource bindings update the whole UI immediately.</summary>
    public static void Apply(string id)
    {
        var app = Application.Current;
        if (app is null) return;
        var p = Get(id);
        var r = app.Resources;
        void Set(string key, string hex) => r[key] = B(hex);

        Set("BgBrush", p.Bg); Set("SurfaceBrush", p.Surface); Set("RaisedBrush", p.Raised);
        Set("TextBrush", p.Text); Set("MutedBrush", p.Muted); Set("SubtleBrush", p.Subtle);
        Set("AccentBrush", p.Accent); Set("Accent2Brush", p.Accent2); Set("AccentTextBrush", p.AccentText);
        Set("OutlineBrush", p.Outline);
        r["AccentColor"] = Color.Parse(p.Accent);
        r["Accent2Color"] = Color.Parse(p.Accent2);

        // Fluent control resources that would otherwise keep the default (unreadable) colors.
        foreach (var k in new[] { "TextControlBackground", "TextControlBackgroundPointerOver", "TextControlBackgroundFocused" }) Set(k, p.Surface);
        foreach (var k in new[] { "TextControlForeground", "TextControlForegroundPointerOver", "TextControlForegroundFocused" }) Set(k, p.Text);
        Set("TextControlBorderBrush", p.Outline);
        Set("TextControlBorderBrushPointerOver", p.Muted);
        Set("TextControlBorderBrushFocused", p.Accent);
        Set("TextControlPlaceholderForeground", p.Subtle);
        Set("TextControlPlaceholderForegroundPointerOver", p.Subtle);
        Set("TextControlPlaceholderForegroundFocused", p.Subtle);
        Set("SliderTrackValueFill", p.Accent); Set("SliderTrackValueFillPointerOver", p.Accent2); Set("SliderTrackValueFillPressed", p.Accent2);
        Set("SliderTrackFill", p.Outline); Set("SliderTrackFillPointerOver", p.Outline); Set("SliderTrackFillPressed", p.Outline);
        Set("SliderThumbBackground", p.Accent); Set("SliderThumbBackgroundPointerOver", p.Accent2); Set("SliderThumbBackgroundPressed", p.Accent2);
        Set("ToggleSwitchFillOn", p.Accent); Set("ToggleSwitchFillOnPointerOver", p.Accent2); Set("ToggleSwitchFillOnPressed", p.Accent2);
        Set("ToggleSwitchKnobFillOn", p.AccentText); Set("ToggleSwitchKnobFillOnPointerOver", p.AccentText); Set("ToggleSwitchKnobFillOnPressed", p.AccentText);
        Set("ToggleSwitchFillOff", p.Raised); Set("ToggleSwitchKnobFillOff", p.Muted);
        Set("ToggleSwitchStrokeOff", p.Outline);
        Set("ScrollBarThumbFill", p.Outline);

        app.RequestedThemeVariant = p.Dark ? ThemeVariant.Dark : ThemeVariant.Light;
    }
}
