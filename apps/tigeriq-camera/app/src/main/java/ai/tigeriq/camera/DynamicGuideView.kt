package ai.tigeriq.camera

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View

/**
 * Rear-camera parking corridor, generated from the bicycle model. It never
 * infers steering from the PHONE gyro: the phone can remain fixed while the
 * wheels turn. When no verified road-wheel angle exists, shows static lines
 * with an explicit "no steering data" warning, not fake dynamic guides.
 *
 * Pixel mapping is an ILLUSTRATIVE perspective transform until the installed
 * camera's distortion, height/pitch and exact bumper position are calibrated.
 */
class DynamicGuideView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null, defStyleAttr: Int = 0
): View(context, attrs, defStyleAttr) {
    private val settings=CameraSettings(context)
    private val line=Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style=Paint.Style.STROKE
        strokeCap=Paint.Cap.ROUND
        strokeJoin=Paint.Join.ROUND
    }
    private val text=Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color=Color.WHITE
        textAlign=Paint.Align.CENTER
        isFakeBoldText=true
    }
    private val sideLeft=Path()
    private val sideRight=Path()
    private var verifiedWheelAngle: Float? = null
    var curvature: Float = 0f
        private set

    var isGuideVisible: Boolean
        get()=settings.isGuidelinesEnabled
        set(v){settings.isGuidelinesEnabled=v;invalidate()}

    /** Existing callers have unverified steering wheel units: DO NOT bend. */
    fun setSteeringDegrees(degrees: Float) {
        verifiedWheelAngle=null
        curvature=0f
        invalidate()
    }

    /** Only use this when a real, calibrated front ROAD WHEEL angle is available. */
    fun setVerifiedRoadWheelAngleDegrees(degrees: Float?) {
        verifiedWheelAngle=degrees?.takeIf{it.isFinite() && it in -35f..35f}
        curvature=(verifiedWheelAngle ?: 0f) / 35f
        invalidate()
    }

    private fun project(xMeters: Double, backMeters: Double): Pair<Float,Float> {
        val focus = 1.6
        val maxBack = 3.0
        // Width mapping for visual guidance only, not a calibrated homography.
        val widthModel = 1.8
        val xPixels = width * 0.235 * focus / (widthModel*0.5)
        val px=(width*0.5 + xMeters*xPixels/(focus+backMeters)).toFloat()
        val p=(backMeters/(focus+backMeters)) / (maxBack/(focus+maxBack))
        val py=(height*0.9 - p*(height*0.58)).toFloat()
        return px to py
    }

    private fun corridor(s:Double):ReversePathGeometry.Corridor =
        ReversePathGeometry.sample(s,(verifiedWheelAngle ?: 0f).toDouble(),2.9,1.8)

    private fun renderSide(canvas: Canvas,left:Boolean,from:Double,to:Double,color:Int) {
        val path=if(left)sideLeft else sideRight
        path.reset()
        val points=24
        for(i in 0..points) {
            val s=from+(to-from)*i/points
            val c=corridor(s)
            val (x,y)=project(
                if(left)c.leftX else c.rightX,
                if(left)c.leftBack else c.rightBack)
            if(i==0)path.moveTo(x,y) else path.lineTo(x,y)
        }
        line.color=color
        line.strokeWidth=resources.displayMetrics.density*3.0f
        canvas.drawPath(path,line)
    }

    private fun distanceBar(canvas:Canvas,distance:Double,color:Int) {
        val c=corridor(distance)
        val (lx,ly)=project(c.leftX,c.leftBack)
        val (rx,ry)=project(c.rightX,c.rightBack)
        line.color=color
        line.strokeWidth=resources.displayMetrics.density*2.1f
        canvas.drawLine(lx,ly,rx,ry,line)
    }

    override fun onDraw(canvas:Canvas) {
        super.onDraw(canvas)
        if(!settings.isGuidelinesEnabled || width<100 || height<100) return
        // Visual themes keep identical physical geometry; only colors change.
        // This avoids style buttons unexpectedly changing the predicted path.
        val palette=when(settings.guidelineStyle) {
            CameraSettings.STYLE_PORSCHE_GT ->
                listOf(Color.rgb(255,45,85),Color.rgb(255,159,10),Color.rgb(48,209,88))
            CameraSettings.STYLE_AUDI_MATRIX ->
                listOf(Color.rgb(255,59,48),Color.rgb(255,204,0),Color.rgb(0,229,255))
            CameraSettings.STYLE_TESLA_CYBER ->
                listOf(Color.rgb(255,69,58),Color.rgb(255,214,10),Color.rgb(100,210,255))
            CameraSettings.STYLE_LUXURY_GOLD ->
                listOf(Color.rgb(244,91,70),Color.rgb(255,190,0),Color.rgb(230,202,100))
            else ->
                listOf(Color.rgb(239,68,68),Color.rgb(255,202,41),Color.rgb(60,210,113))
        }
        // No uncalibrated 0.5m/1m numeric screen measurements.
        val zones=listOf(0.0 to 0.5,0.5 to 1.4,1.4 to 3.0)
        zones.forEachIndexed { index,zone ->
            renderSide(canvas,true,zone.first,zone.second,palette[index])
            renderSide(canvas,false,zone.first,zone.second,palette[index])
            distanceBar(canvas,zone.second,palette[index])
        }
        text.textSize=resources.displayMetrics.density*12f
        text.color=Color.rgb(255,221,117)
        val message=if(verifiedWheelAngle==null)
            "V?CH T?NH - CH?A NH?N G?C L?I T? XE"
        else "QU? ??O M? PH?NG - CH?A HI?U CHU?N CAMERA"
        canvas.drawText(message,width*0.5f,height*0.23f,text)
    }
}
