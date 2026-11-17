package ai.tigeriq.ultracarhcm.v2

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.view.View
import kotlin.math.roundToInt

/**
 * Clean-room, deterministic Canvas fallback when OWNER-LICENSED V1 multimedia
 * assets are absent. This is original illustrative artwork, NOT the original
 * road, vehicle, logo, weather video, licensed footage, or real camera view.
 *
 * Render from the target display's actual View dimensions and never cache
 * phone pixels for an external display. Existing resource paths take precedence.
 */
internal object HomeFallbackVisualRules {
    const val SKYLINE_HORIZON = 0.49f
    const val ROAD_BOTTOM = 1.03f

    fun fraction(value: Float): Float =
        (value.takeIf { it.isFinite() } ?: 0f).coerceIn(0f, 1f)

    fun buildingHeight(index: Int): Float {
        val seed = ((index * 17 + 11) % 23 + 23) % 23
        return 0.065f + seed * 0.006f
    }
}

internal class RoadCityFallbackView(
    context: Context,
    private val night: Boolean,
) : View(context) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val skyline = Path()
    private val road = Path()

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w < 1f || h < 1f) return

        p.shader = LinearGradient(
            0f, 0f, 0f, h,
            if (night) intArrayOf(0xff040819.toInt(), 0xff142d48.toInt(), 0xff03080f.toInt())
            else intArrayOf(0xff0d3345.toInt(), 0xff396982.toInt(), 0xff081a27.toInt()),
            floatArrayOf(0f, .57f, 1f),
            Shader.TileMode.CLAMP,
        )
        p.style = Paint.Style.FILL
        canvas.drawRect(0f, 0f, w, h, p)
        p.shader = null

        // Distant sky glow has its own palette and is not derived from V1 media.
        p.shader = RadialGradient(
            w * .51f, h * .49f, w * .52f,
            intArrayOf(
                if (night) 0x5538b4e8 else 0x885fa1c4.toInt(),
                0x0036a6b9,
            ),
            null,
            Shader.TileMode.CLAMP,
        )
        canvas.drawRect(0f, 0f, w, h, p)
        p.shader = null

        val horizon = HomeFallbackVisualRules.SKYLINE_HORIZON * h
        p.color = if (night) 0xff0a1524.toInt() else 0xff193849.toInt()
        p.style = Paint.Style.FILL
        skyline.reset()
        skyline.moveTo(0f, horizon)
        val buildings = 30
        for (index in 0..buildings) {
            val x = index * w / buildings
            val roofY = horizon - HomeFallbackVisualRules.buildingHeight(index) * h
            skyline.lineTo(x, roofY)
            skyline.lineTo((x + w / buildings * .82f).coerceAtMost(w), roofY)
            skyline.lineTo((x + w / buildings * .82f).coerceAtMost(w), horizon)
        }
        skyline.lineTo(w, horizon + 1f)
        skyline.lineTo(0f, horizon + 1f)
        skyline.close()
        canvas.drawPath(skyline, p)

        // Controlled, spaced windows: never a media image or simulated location.
        p.color = if (night) 0x9989d5e8.toInt() else 0x88b8e4ef.toInt()
        for (index in 1..54) {
            val x = w * (index + .4f) / 55f
            val block = (index * 11) % buildings
            val top = horizon - HomeFallbackVisualRules.buildingHeight(block) * h
            val rows = if (index % 3 == 0) 4 else 2
            for (row in 1..rows) {
                val y = horizon - row * .017f * h
                if (y <= top + h * .007f) continue
                canvas.drawRect(x, y, x + w * .0028f, y + h * .004f, p)
            }
        }

        road.reset()
        road.moveTo(w * .432f, horizon)
        road.lineTo(w * .568f, horizon)
        road.lineTo(w * HomeFallbackVisualRules.ROAD_BOTTOM, h)
        road.lineTo(-w * .03f, h)
        road.close()
        p.shader = LinearGradient(
            0f, horizon, 0f, h,
            intArrayOf(0xff101d2b.toInt(), 0xff26384c.toInt(), 0xff0b121d.toInt()),
            null,
            Shader.TileMode.CLAMP,
        )
        canvas.drawPath(road, p)
        p.shader = null

        // Original perspective lane tracers; no false lane guidance/calibration.
        p.style = Paint.Style.STROKE
        p.strokeCap = Paint.Cap.ROUND
        for (side in listOf(-1f, 1f)) {
            p.strokeWidth = (w * .0017f).coerceAtLeast(1f)
            p.color = if (night) 0x997bd1fc.toInt() else 0x997cbbd9.toInt()
            val line = Path()
            line.moveTo(w * (.50f + side * .026f), horizon)
            line.lineTo(w * (.50f + side * .38f), h)
            canvas.drawPath(line, p)
        }
        // Animated media is intentionally not faked: static reflections only.
        p.style = Paint.Style.FILL
        for (index in 0 until 9) {
            val depth = (index + 1) / 10f
            val y = horizon + (h - horizon) * depth * depth
            val cx = w * (.5f + if (index % 2 == 0) -.24f else .24f) * (1 - depth) +
                w * .5f * depth
            val length = w * (.018f + .065f * depth)
            p.color = if (index % 2 == 0) 0x885ad7e9.toInt() else 0x88fc78ac.toInt()
            canvas.drawRoundRect(
                RectF(cx - length * .5f, y, cx + length * .5f, y + (h * .0024f).coerceAtLeast(1f)),
                2f, 2f, p,
            )
        }
        p.color = 0x4c010711
        canvas.drawRect(0f, h * .84f, w, h, p)
    }
}

/**
 * Generic stylised parked car silhouette. Does NOT copy Lamborghini/VinFast
 * emblems, original V1 vehicle images, or claim to show the physical vehicle.
 */
internal class ParkedVehicleFallbackView(
    context: Context,
    private val vehicleModel: String,
) : View(context) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val body = Path()
    private val glass = Path()

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return
        canvas.save()
        canvas.scale(w / 1000f, h / 400f)

        val isLimo = vehicleModel == VehicleRules.MODEL_LIMO_RED
        val bodyTop = if (isLimo) 125f else 158f
        val paintColor = if (isLimo) 0xffc2364b.toInt() else 0xffdceaf5.toInt()
        val trimColor = if (isLimo) 0xfff06b76.toInt() else 0xff91cdec.toInt()

        p.style = Paint.Style.FILL
        p.shader = RadialGradient(
            500f, 315f, 450f,
            intArrayOf(0x8842bcdb.toInt(), Color.TRANSPARENT),
            null, Shader.TileMode.CLAMP,
        )
        canvas.drawOval(RectF(110f, 294f, 920f, 370f), p)
        p.shader = null
        p.color = 0x9e00030d.toInt()
        canvas.drawOval(RectF(138f, 310f, 885f, 364f), p)

        body.reset()
        body.moveTo(120f, 254f)
        body.cubicTo(155f, 215f, 211f, 214f, 286f, 197f)
        body.cubicTo(340f, bodyTop - 20f, 449f, bodyTop, 559f, bodyTop - 5f)
        body.cubicTo(667f, bodyTop - 1f, 725f, 182f, 759f, 210f)
        body.cubicTo(834f, 213f, 885f, 224f, 908f, 255f)
        body.lineTo(921f, 302f)
        body.cubicTo(856f, 325f, 187f, 324f, 97f, 298f)
        body.close()
        p.color = paintColor
        canvas.drawPath(body, p)

        p.shader = LinearGradient(
            0f, bodyTop - 10f, 0f, 317f,
            intArrayOf(trimColor, paintColor, 0xff526e7e.toInt()),
            null, Shader.TileMode.CLAMP,
        )
        canvas.drawPath(body, p)
        p.shader = null

        glass.reset()
        glass.moveTo(326f, 195f)
        glass.cubicTo(373f, bodyTop + 1f, 466f, bodyTop + 16f, 545f, bodyTop + 15f)
        glass.cubicTo(620f, bodyTop + 17f, 675f, 191f, 699f, 203f)
        glass.close()
        p.color = 0xff122b3c.toInt()
        canvas.drawPath(glass, p)

        p.color = 0x9977d3f3.toInt()
        p.strokeWidth = 7f
        p.style = Paint.Style.STROKE
        canvas.drawPath(glass, p)
        p.style = Paint.Style.FILL

        p.color = 0xff101923.toInt()
        for (centerX in floatArrayOf(260f, 756f)) {
            canvas.drawCircle(centerX, 299f, 66f, p)
            p.color = 0xff546675.toInt()
            canvas.drawCircle(centerX, 299f, 38f, p)
            p.color = 0xffb7d7e5.toInt()
            canvas.drawCircle(centerX, 299f, 18f, p)
            p.color = 0xff101923.toInt()
        }
        p.color = 0xffb7f1ff.toInt()
        canvas.drawRoundRect(RectF(875f, 247f, 935f, 267f), 10f, 10f, p)
        p.color = 0xffee5678.toInt()
        canvas.drawRoundRect(RectF(101f, 261f, 143f, 284f), 9f, 9f, p)
        p.color = 0xb9ffffff.toInt()
        p.strokeWidth = 3f
        p.style = Paint.Style.STROKE
        canvas.drawLine(195f, 241f, 832f, 229f, p)

        canvas.restore()
    }
}
