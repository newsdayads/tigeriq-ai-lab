package com.tigeriq.camera;

import android.app.Activity;
import android.media.AudioManager;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.Window;

/**
 * Isolated fallback dialog Activity (separate taskAffinity) used only when launched from
 * Android Accessibility Settings -> UltraCar settings or if overlay permission is unavailable.
 */
public class RemoteShortcutConfigActivity extends Activity {
    private RemoteShortcutOverlayDialog.PanelController panel;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setVolumeControlStream(AudioManager.USE_DEFAULT_STREAM_TYPE);

        panel = new RemoteShortcutOverlayDialog.PanelController(this, new Runnable() {
            @Override
            public void run() {
                finish();
            }
        });
        setContentView(panel.buildRootCard());
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (panel != null) {
            panel.onResume();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (panel != null) {
            panel.onPause();
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (panel != null && panel.onDirectKeyEvent(event)) {
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
