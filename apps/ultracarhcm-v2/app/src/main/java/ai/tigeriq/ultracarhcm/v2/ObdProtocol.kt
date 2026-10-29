package ai.tigeriq.ultracarhcm.v2

internal object ObdProtocol {
    private val hexByte = Regex("^[0-9A-F]{2}$")

    fun normalize(response: String): List<String> =
        response
            .uppercase()
            .replace("\\r", " ")
            .replace("\\n", " ")
            .replace(">", " ")
            .trim()
            .split(Regex("\\s+"))
            .filter { it.isNotEmpty() }

    fun parseSpeedKph(response: String): Int? {
        val tokens = normalize(response)
        val index = findHeader(tokens, "41", "0D")
        if (index < 0 || index + 2 >= tokens.size) return null
        return byte(tokens[index + 2])
    }

    fun parseRpm(response: String): Int? {
        val tokens = normalize(response)
        val index = findHeader(tokens, "41", "0C")
        if (index < 0 || index + 3 >= tokens.size) return null
        val a = byte(tokens[index + 2]) ?: return null
        val b = byte(tokens[index + 3]) ?: return null
        return ((a * 256) + b) / 4
    }

    fun parseVoltage(response: String): Double? {
        val match = Regex("([0-9]+(?:\\.[0-9]+)?)\\s*V", RegexOption.IGNORE_CASE)
            .find(response)
            ?: return null
        return match.groupValues[1].toDoubleOrNull()
    }

    private fun findHeader(tokens: List<String>, first: String, second: String): Int {
        for (index in 0 until tokens.size - 1) {
            if (tokens[index] == first && tokens[index + 1] == second) return index
        }
        return -1
    }

    private fun byte(value: String): Int? =
        if (hexByte.matches(value)) value.toIntOrNull(16) else null
}
