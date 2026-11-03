package ai.tigeriq.camera

/** Exact receiving/parsing semantics decompiled from UltraCar v1.0.17 ReverseGearReceiver.
 * Not a CAN-bus decoder; caller must have an actual REVERSE broadcast source.
 */
object UltraCarReverseSignal {
    fun parse(action: String?, state: Boolean, gear: String?): Boolean? {
        if (action?.contains("REVERSE") != true) return null
        return gear?.equals("R", ignoreCase = true) ?: state
    }
}
