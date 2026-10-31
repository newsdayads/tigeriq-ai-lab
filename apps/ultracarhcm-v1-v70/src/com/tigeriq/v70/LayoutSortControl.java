package com.tigeriq.v70;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;

public final class LayoutSortControl {
    private static final String LABEL = "≡ SẮP XẾP BỐ CỤC";
    private static Activity current;
    private static TextView button;

    private LayoutSortControl() {}

    public static void show() {
        final Activity a = resolveActivity();
        if (a == null || a.isFinishing()) return;
        a.runOnUiThread(() -> {
            if (a.isFinishing()) return;
            FrameLayout root = (FrameLayout)a.findViewById(android.R.id.content);
            if (root == null) return;
            if (current != a || button == null || button.getParent() != root) {
                removeOld();
                current = a;
                TextView control = new TextView(a);
                control.setText(LABEL);
                control.setTextSize(13);
                control.setTextColor(Color.WHITE);
                control.setGravity(Gravity.CENTER);
                control.setAllCaps(false);
                control.setContentDescription("Sắp xếp vị trí các bố cục đã lưu");
                GradientDrawable bg = new GradientDrawable();
                bg.setColor(0xff283343);
                bg.setCornerRadius(dp(a,10));
                bg.setStroke(dp(a,1),0xffee5b20);
                control.setBackground(bg);
                control.setElevation(dp(a,9));
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                    dp(a,165),dp(a,42),Gravity.TOP|Gravity.RIGHT);
                lp.rightMargin=dp(a,18);
                lp.topMargin=dp(a,5);
                root.addView(control,lp);
                control.setOnClickListener(v -> openOrderDialog(a));
                button=control;
            }
            button.setVisibility(View.VISIBLE);
            button.bringToFront();
        });
    }

    public static void hide() {
        final Activity a=current;
        if (a==null) return;
        a.runOnUiThread(() -> {
            if (button!=null && current==a) button.setVisibility(View.GONE);
        });
    }

    private static Activity resolveActivity() {
        try {
            Class<?> bridge=Class.forName("com.tigeriq.v44.V44UiBridge");
            Object value=bridge.getMethod("getActivity").invoke(null);
            if(value instanceof Activity) return (Activity)value;
        } catch(Exception ignored) {}
        try {
            Class<?> bridge=Class.forName("com.ultracar.dexsplit.ui.TigerIQBridge");
            Field f=bridge.getDeclaredField("sInstance");
            return (Activity)f.get(null);
        } catch(Exception ignored) {}
        return null;
    }

    private static int dp(Context c,float d) {
        return (int)(c.getResources().getDisplayMetrics().density*d+0.5f);
    }

    private static void removeOld() {
        if(button!=null && button.getParent() instanceof ViewGroup)
            ((ViewGroup)button.getParent()).removeView(button);
        button=null;
    }

    private static void openOrderDialog(Activity a) {
        try {
            Class<?> manager=Class.forName("com.tigeriq.layout.Manager");
            Field list=manager.getDeclaredField("current");
            list.setAccessible(true);
            Object data=list.get(null);
            if(!(data instanceof List) || ((List<?>)data).size()<2) {
                new AlertDialog.Builder(a)
                    .setTitle("Chưa tải danh sách bố cục")
                    .setMessage("Vui lòng mở lại màn hình Bố cục đã lưu.")
                    .setPositiveButton("Đóng",null).show();
                return;
            }
            Method show=manager.getDeclaredMethod("show");
            show.setAccessible(true);
            show.invoke(null);
        } catch(Exception error) {
            android.util.Log.e("TigerIQ-V70","Cannot open order editor",error);
            Toast.makeText(a,"Không mở được Sắp xếp. Vui lòng mở lại màn hình.",Toast.LENGTH_LONG).show();
        }
    }
}
