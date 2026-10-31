package com.tigeriq.v72;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.PopupWindow;
import android.widget.TextView;
import android.widget.Toast;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;

public final class SortPopup {
  private static final String TAG = "TigerIQ-V72-Sort";
  private static PopupWindow popup;
  private static Activity activity;
  private SortPopup() {}

  public static void show() {
    try {
      Activity a = resolve();
      if (a == null || a.isFinishing()) {
        Log.w(TAG, "Cannot show reorder button: missing Activity");
        return;
      }
      a.runOnUiThread(() -> showOnUi(a));
    } catch (Throwable t) {
      Log.e(TAG, "Cannot initialize native reorder button", t);
    }
  }

  private static Activity resolve() throws Exception {
    Class<?> c = Class.forName("com.ultracar.dexsplit.ui.TigerIQBridge");
    Field f = c.getDeclaredField("sInstance");
    f.setAccessible(true);
    Object inst = f.get(null);
    if (inst instanceof Activity) return (Activity)inst;
    c = Class.forName("com.tigeriq.v44.V44UiBridge");
    Method m = c.getMethod("getActivity");
    inst = m.invoke(null);
    return inst instanceof Activity ? (Activity)inst : null;
  }

  private static int dp(Activity a, int number) {
    return Math.round(number * a.getResources().getDisplayMetrics().density);
  }

  private static void showOnUi(Activity a) {
    try {
      if (a.isFinishing() || a.getWindow() == null) return;
      if (popup != null && popup.isShowing() && activity == a) return;
      if (popup != null) popup.dismiss();
      activity = a;
      TextView button = new TextView(a);
      button.setText("\u2261 S\u1eaeP X\u1ebeP B\u1ed0 C\u1ee4C");
      button.setTextColor(Color.WHITE);
      button.setTextSize(14);
      button.setGravity(Gravity.CENTER);
      button.setContentDescription("M\u1edf c\u1eeda s\u1ed5 s\u1eafp x\u1ebfp b\u1ed1 c\u1ee5c");
      GradientDrawable bg = new GradientDrawable();
      bg.setColor(0xffd94a1c);
      bg.setCornerRadius(dp(a, 9));
      button.setBackground(bg);
      button.setOnClickListener(v -> openEditor(a));
      PopupWindow w = new PopupWindow(button, dp(a, 172), dp(a, 48), false);
      w.setOutsideTouchable(false);
      w.setFocusable(false);
      w.setClippingEnabled(true);
      w.setElevation(dp(a, 14));
      popup = w;
      w.showAtLocation(a.getWindow().getDecorView(), Gravity.TOP | Gravity.RIGHT,
                       dp(a, 16), dp(a, 72));
      Log.i(TAG, "NATIVE_SORT_BUTTON_SHOWN");
    } catch (Throwable t) {
      Log.e(TAG, "SORT_BUTTON_SHOW_FAILED", t);
    }
  }

  private static void openEditor(Activity a) {
    try {
      Class<?> manager = Class.forName("com.tigeriq.layout.Manager");
      Field list = manager.getDeclaredField("current");
      list.setAccessible(true);
      Object value = list.get(null);
      if (!(value instanceof List) || ((List<?>) value).size() < 2) {
        Toast.makeText(a, "Danh s\u00e1ch b\u1ed1 c\u1ee5c ch\u01b0a s\u1eb5n s\u00e0ng", Toast.LENGTH_LONG).show();
        return;
      }
      Method show = manager.getDeclaredMethod("show");
      show.setAccessible(true);
      show.invoke(null);
      Log.i(TAG, "NATIVE_REORDER_EDITOR_OPENED");
    } catch (Throwable t) {
      Log.e(TAG, "NATIVE_REORDER_EDITOR_ERROR", t);
      Toast.makeText(a, "Kh\u00f4ng m\u1edf \u0111\u01b0\u1ee3c s\u1eafp x\u1ebfp; xem log V72", Toast.LENGTH_LONG).show();
    }
  }

  public static void hide() {
    new Handler(Looper.getMainLooper()).post(() -> {
      if (popup != null) { popup.dismiss(); popup = null; }
      activity = null;
    });
  }
}
