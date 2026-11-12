package com.tigeriq.camera;

import android.content.Context;
import android.graphics.Canvas;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.util.AttributeSet;
import android.view.View;
import android.widget.ImageView;

/**
 * Lightweight binary-compatible stub preserving OverlayControls/GuideTrackView/ReverseGuidelineOverlay
 * APIs while delegating all guideline rendering & motion sensing to NativeGuideWarpView + GuideMotionHub.
 */
public class DynamicGuideView extends ImageView implements SensorEventListener {
    public DynamicGuideView(Context context) {
        super(context);
    }

    public DynamicGuideView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public void setCameraPreview(View preview) {
    }

    protected final float currentCurve() {
        return 0f;
    }

    protected final boolean gyroDetected() {
        return false;
    }

    protected final boolean imageMotionDetected() {
        return false;
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
    }

    @Override
    protected void onDraw(Canvas canvas) {
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
    }
}
