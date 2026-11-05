package com.tigeriq.v73;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;

public final class LayoutReorderEntry {
    private static final String TAG = "TigerIQ-V73-Reorder";
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static boolean armed;
    private static boolean shown;
    private static int tries;
    private LayoutReorderEntry() {}

    public static void arm() {
        MAIN.post(() -> {
            if (!armed) {
                armed = true;
                shown = false;
                tries = 0;
                Log.i(TAG, "SAVED_LAYOUT_EDITOR_ARMED");
            }
        });
    }

    public static void listReady() {
        MAIN.post(() -> {
            if (armed && !shown) {
                MAIN.removeCallbacks(RETRY);
                MAIN.postDelayed(RETRY, 450);
            }
        });
    }

    private static final Runnable RETRY = new Runnable() {
        @Override public void run() {
            if (!armed || shown) return;
            try {
                Class<?> manager=Class.forName("com.tigeriq.layout.Manager");
                Field list=manager.getDeclaredField("current");
                list.setAccessible(true);
                Object current=list.get(null);
                if (!(current instanceof List) || ((List<?>)current).size() < 2) {
                    if (++tries < 8) MAIN.postDelayed(this, 400);
                    else Log.w(TAG,"REORDER_LIST_NOT_READY");
                    return;
                }
                Method method=manager.getDeclaredMethod("show");
                method.setAccessible(true);
                method.invoke(null);
                shown=true;
                Log.i(TAG,"NATIVE_REORDER_DIALOG_OPENED");
            } catch (Throwable e) {
                Log.e(TAG,"NATIVE_REORDER_FAILED",e);
            }
        }
    };

    public static void reset() {
        MAIN.post(() -> {
            armed=false;
            shown=false;
            tries=0;
            MAIN.removeCallbacks(RETRY);
        });
    }
}
