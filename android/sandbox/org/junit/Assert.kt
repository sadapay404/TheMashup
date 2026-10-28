// Sandbox-only stub of org.junit.Assert — API-compatible with every call the
// test suites make (mirrors JUnit4 signatures so overload resolution matches
// the real Gradle build). Real JUnit is used on the build machine.
@file:Suppress("unused", "UNUSED_PARAMETER")

package org.junit

object Assert {

    @JvmStatic
    fun assertEquals(expected: Any?, actual: Any?) = assertEquals(null, expected, actual)

    @JvmStatic
    fun assertEquals(message: String?, expected: Any?, actual: Any?) {
        if (expected == actual) return
        fail(format(message, "expected:<$expected> but was:<$actual>"))
    }

    @JvmStatic
    fun assertEquals(expected: Double, actual: Double, delta: Double) =
        assertEquals(null, expected, actual, delta)

    @JvmStatic
    fun assertEquals(message: String?, expected: Double, actual: Double, delta: Double) {
        if (actual.isNaN() && expected.isNaN()) return
        if (kotlin.math.abs(expected - actual) <= delta) return
        fail(format(message, "expected:<$expected> but was:<$actual>"))
    }

    @JvmStatic
    fun assertTrue(condition: Boolean) = assertTrue(null, condition)

    @JvmStatic
    fun assertTrue(message: String?, condition: Boolean) {
        if (!condition) fail(format(message, "expected true"))
    }

    @JvmStatic
    fun assertFalse(condition: Boolean) = assertFalse(null, condition)

    @JvmStatic
    fun assertFalse(message: String?, condition: Boolean) {
        if (condition) fail(format(message, "expected false"))
    }

    @JvmStatic
    fun assertNull(value: Any?) = assertNull(null, value)

    @JvmStatic
    fun assertNull(message: String?, value: Any?) {
        if (value != null) fail(format(message, "expected null but was:<$value>"))
    }

    @JvmStatic
    fun assertNotNull(value: Any?) = assertNotNull(null, value)

    @JvmStatic
    fun assertNotNull(message: String?, value: Any?) {
        if (value == null) fail(format(message, "expected not null"))
    }

    @JvmStatic
    fun assertNotEquals(unexpected: Any?, actual: Any?) = assertNotEquals(null, unexpected, actual)

    @JvmStatic
    fun assertNotEquals(message: String?, unexpected: Any?, actual: Any?) {
        if (unexpected != actual) return
        fail(format(message, "unexpectedly equal:<$actual>"))
    }

    @JvmStatic
    fun assertNotEquals(unexpected: Double, actual: Double, delta: Double) =
        assertNotEquals(null, unexpected, actual, delta)

    @JvmStatic
    fun assertNotEquals(message: String?, unexpected: Double, actual: Double, delta: Double) {
        if (kotlin.math.abs(unexpected - actual) > delta) return
        fail(format(message, "unexpectedly equal:<$actual>"))
    }

    @JvmStatic
    fun fail(message: String? = null) {
        throw AssertionError(message ?: "assertion failed")
    }

    private fun format(message: String?, detail: String): String =
        if (message == null) detail else "$message ==> $detail"
}
