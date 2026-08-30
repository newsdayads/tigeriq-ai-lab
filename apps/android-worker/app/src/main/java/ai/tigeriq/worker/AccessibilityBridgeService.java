package ai.tigeriq.worker;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

public final class AccessibilityBridgeService extends AccessibilityService {
    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // MVP gate: observe semantic tree availability only. No autonomous third-party
        // UI actions are enabled until real-device pairing, allowlists and evidence gates pass.
    }

    @Override
    public void onInterrupt() {
        // No-op; controller watchdog will classify interrupted execution later.
    }

    public boolean semanticTreeAvailable() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        return root != null;
    }
}
