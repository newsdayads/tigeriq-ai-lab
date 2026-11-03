package ai.tigeriq.camera

/**
 * Capture-box-specific hypothesis from read-only Z Fold2 NV21 summaries.
 *
 * IDLE: repeated exact converter standby signature (luma ~30, almost constant).
 * ACTIVE: content-rich frames (never infer "OFF" from darkness/no frames).
 * Neither classification proves gearbox gear R or P/N/D until field correlation.
 */
class VideoSignalClassifier(
    private val activeSamples: Int = 5,
    private val idleSamples: Int = 7
) {
    enum class State { UNKNOWN, IDLE_PATTERN, VIDEO_ACTIVE }
    var state = State.UNKNOWN
        private set
    private var consecutive = 0
    private var candidate = State.UNKNOWN
    fun reset() { state = State.UNKNOWN; candidate = State.UNKNOWN; consecutive = 0 }

    fun classify(m: UvcFrameSignalEvidence.Metrics): State {
        return when {
            m.meanLuma in 28.0..32.0 &&
                m.lumaVariance <= 4.5 &&
                m.occupiedLumaBins <= 2 -> State.IDLE_PATTERN
            m.lumaVariance >= 80.0 &&
                m.occupiedLumaBins >= 5 -> State.VIDEO_ACTIVE
            else -> State.UNKNOWN
        }
    }

    /** Only returns a state when it CHANGES after stable evidence. */
    fun accept(m: UvcFrameSignalEvidence.Metrics): State? {
        val observation = classify(m)
        if (observation == State.UNKNOWN) {
            candidate = State.UNKNOWN
            consecutive = 0
            return null
        }
        if (observation != candidate) {
            candidate = observation
            consecutive = 1
        } else consecutive++
        if (observation != state &&
            consecutive >= if (observation == State.VIDEO_ACTIVE) activeSamples else idleSamples) {
            state = observation
            return state
        }
        return null
    }
}
