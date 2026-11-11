package ai.tigeriq.camera

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Pure, deterministic steering-motion estimator combining gravity-aligned gyroscope yaw
 * with UVC road-texture motion gating to avoid stationary idle vibration & MEMS drift.
 */
class MotionSteeringEstimator {
    private var biasRadPerSec = 0f
    private var yawSlowRadPerSec = 0f
    private var lastGyroMs = 0L
    private var lastStepMs = 0L
    private var turnHoldStartMs = 0L
    private var turnHoldSign = 0
    private var baseDegrees = 0f

    @Volatile
    private var lastMotionScore = 0f

    @Volatile
    private var lastMotionMs = 0L

    @Synchronized
    fun reset() {
        yawSlowRadPerSec = 0f
        lastGyroMs = 0L
        lastStepMs = 0L
        turnHoldStartMs = 0L
        turnHoldSign = 0
        baseDegrees = 0f
    }

    fun onVideoMotionScore(score: Float, timestampMs: Long) {
        if (!score.isFinite() || score < 0f) return
        lastMotionScore = score
        lastMotionMs = timestampMs
    }

    @Synchronized
    fun onGyroSample(
        wx: Float,
        wy: Float,
        wz: Float,
        gx: Float,
        gy: Float,
        gz: Float,
        hasGravity: Boolean,
        timestampMs: Long
    ) {
        val gNormSq = gx * gx + gy * gy + gz * gz
        val rawYaw = if (hasGravity && gNormSq > 25f) {
            (wx * gx + wy * gy + wz * gz) / sqrt(gNormSq)
        } else {
            wy
        }
        if (!rawYaw.isFinite()) return
        val clampedYaw = rawYaw.coerceIn(-4.0f, 4.0f)

        val dtSec = if (lastGyroMs == 0L || timestampMs <= lastGyroMs) {
            0.03f
        } else {
            val delta = timestampMs - lastGyroMs
            if (delta > 1000L) {
                yawSlowRadPerSec = 0f
                turnHoldStartMs = 0L
                turnHoldSign = 0
                0.03f
            } else {
                (delta.coerceIn(1L, 250L)) / 1000f
            }
        }
        lastGyroMs = timestampMs

        // Slow MEMS zero-offset bias tracking strictly when vehicle is calm.
        if (abs(clampedYaw - biasRadPerSec) < 0.028f && abs(yawSlowRadPerSec) < 0.035f) {
            val biasAlpha = (dtSec / 1.2f).coerceIn(0.005f, 0.05f)
            biasRadPerSec += biasAlpha * (clampedYaw - biasRadPerSec)
        }

        val cleanYaw = clampedYaw - biasRadPerSec
        val lpfAlpha = (dtSec / (0.14f + dtSec)).coerceIn(0.05f, 0.70f)
        yawSlowRadPerSec += lpfAlpha * (cleanYaw - yawSlowRadPerSec)

        val activeDeadband = resolveDeadband(timestampMs)
        val absYaw = abs(yawSlowRadPerSec)
        if (absYaw > activeDeadband) {
            val sign = if (yawSlowRadPerSec > 0f) 1 else -1
            if (sign != turnHoldSign) {
                turnHoldSign = sign
                turnHoldStartMs = timestampMs
            }
        } else {
            turnHoldSign = 0
            turnHoldStartMs = 0L
        }
    }

    @Synchronized
    fun step(nowMs: Long, inverted: Boolean): Float {
        val dtSec = if (lastStepMs == 0L || nowMs <= lastStepMs) {
            0.033f
        } else {
            (nowMs - lastStepMs).coerceIn(1L, 250L) / 1000f
        }
        lastStepMs = nowMs

        // If sensor stream goes silent briefly, decay curvature smoothly back to straight.
        if (lastGyroMs > 0L && nowMs - lastGyroMs > 450L) {
            val decayAlpha = (dtSec / (0.18f + dtSec)).coerceIn(0.05f, 0.7f)
            yawSlowRadPerSec *= (1f - decayAlpha)
            if (abs(yawSlowRadPerSec) < 0.01f) yawSlowRadPerSec = 0f
            turnHoldSign = 0
            turnHoldStartMs = 0L
        }

        val activeDeadband = resolveDeadband(nowMs)
        val confirmMs = resolveConfirmMs(nowMs)
        val absYaw = abs(yawSlowRadPerSec)
        val targetBase = if (
            turnHoldSign != 0 &&
            turnHoldStartMs > 0L &&
            absYaw > activeDeadband &&
            nowMs - turnHoldStartMs >= confirmMs
        ) {
            // Reversing clockwise around +gravity (yaw < 0) curves right (+) before inversion.
            val dir = if (yawSlowRadPerSec < 0f) 1f else -1f
            val strength = ((absYaw - activeDeadband) * 145f).coerceIn(0f, 32f)
            dir * strength
        } else {
            0f
        }

        val tau = when {
            targetBase == 0f -> 0.12f
            abs(targetBase) > abs(baseDegrees) -> 0.10f
            else -> 0.18f
        }
        val smoothAlpha = (dtSec / (tau + dtSec)).coerceIn(0.08f, 0.75f)
        baseDegrees += smoothAlpha * (targetBase - baseDegrees)
        if (abs(baseDegrees) < 0.35f && targetBase == 0f) {
            baseDegrees = 0f
        }
        return if (inverted) -baseDegrees else baseDegrees
    }

    private fun resolveDeadband(nowMs: Long): Float {
        val motionFresh = lastMotionMs > 0L && (nowMs - lastMotionMs) in 0L..600L
        if (!motionFresh) return 0.045f
        return when {
            lastMotionScore >= 2.8f -> 0.042f
            lastMotionScore < 1.0f -> 0.068f
            else -> 0.050f
        }
    }

    private fun resolveConfirmMs(nowMs: Long): Long {
        val motionFresh = lastMotionMs > 0L && (nowMs - lastMotionMs) in 0L..600L
        if (!motionFresh) return 80L
        return when {
            lastMotionScore >= 2.8f -> 30L
            lastMotionScore < 1.0f -> 130L
            else -> 75L
        }
    }
}

/** Resolves effective steering road-wheel degrees preserving strict authority priority. */
class GuideSteeringResolver {
    private var verifiedRoadWheelDegrees: Float? = null
    private var legacyExternalDegrees: Float? = null

    fun setVerifiedRoadWheelAngleDegrees(degrees: Float?) {
        verifiedRoadWheelDegrees = degrees?.takeIf { it.isFinite() && it in -35f..35f }
    }

    fun setLegacySteeringDegrees(degrees: Float, inverted: Boolean) {
        if (!degrees.isFinite() || abs(degrees) <= 0.5f) {
            legacyExternalDegrees = null
            return
        }
        val dir = if (inverted) -1f else 1f
        legacyExternalDegrees = (degrees / 15f * dir).coerceIn(-35f, 35f)
    }

    fun resolveTargetDegrees(motionDegrees: Float): Float {
        verifiedRoadWheelDegrees?.let { return it }
        legacyExternalDegrees?.let { return it }
        return motionDegrees.takeIf { it.isFinite() }?.coerceIn(-35f, 35f) ?: 0f
    }
}
