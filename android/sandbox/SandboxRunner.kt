// Reflective JUnit-style runner for the sandbox (no Gradle/JDK toolchain
// beyond the downloaded Kotlin compiler + Temurin JDK in tools/).
// Usage: java -jar domain-tests.jar <fqcn of test class> ...
fun main(args: Array<String>) {
    if (args.isEmpty()) {
        println("usage: domain-tests.jar <test-class> [more test-classes...]")
        kotlin.system.exitProcess(2)
    }
    var passed = 0
    val failures = mutableListOf<String>()

    for (fqcn in args) {
        val cls = try {
            Class.forName(fqcn)
        } catch (e: ClassNotFoundException) {
            failures += "$fqcn: class not found"
            continue
        }
        val instance = cls.getDeclaredConstructor().newInstance()
        val methods = cls.declaredMethods
            .filter { it.isAnnotationPresent(org.junit.Test::class.java) }
            .sortedBy { it.name }
        if (methods.isEmpty()) {
            failures += "$fqcn: no @Test methods"
            continue
        }
        for (m in methods) {
            m.isAccessible = true
            try {
                m.invoke(instance)
                passed++
                println("PASS  ${cls.simpleName}.${m.name}")
            } catch (e: java.lang.reflect.InvocationTargetException) {
                val cause = e.cause ?: e
                failures += "${cls.simpleName}.${m.name}: ${cause.javaClass.simpleName}: ${cause.message}"
                println("FAIL  ${cls.simpleName}.${m.name}: ${cause.message}")
            }
        }
    }

    println()
    println("sandbox domain tests: $passed passed, ${failures.size} failed")
    if (failures.isNotEmpty()) {
        failures.forEach { println("  - $it") }
        kotlin.system.exitProcess(1)
    }
}
