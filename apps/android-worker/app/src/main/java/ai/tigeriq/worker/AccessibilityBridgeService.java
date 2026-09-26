package ai.tigeriq.worker;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

public final class AccessibilityBridgeService extends AccessibilityService {
    public static final String PREFS = "tigeriq-accessibility-pilot";
    public static final String KEY_LAST_PACKAGE = "lastPackage";
    public static final String KEY_LAST_EVENT_AT = "lastEventAt";

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Pilot gate: record only foreground package/timestamp. Do not read prompt/output text
        // and do not perform autonomous third-party UI actions until the real-device adapter
        // has an explicit allowlist and provider-specific evidence gate.
        CharSequence packageName = event == null ? null : event.getPackageName();
        if (packageName != null) {
            String value = packageName.toString();
            if (getPackageName().equals(value)) return;
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_LAST_PACKAGE, value)
                .putLong(KEY_LAST_EVENT_AT, System.currentTimeMillis())
                .apply();
        }
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
