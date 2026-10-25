package com.tigeriq.v44;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class V44UiBridge {
    private static Activity activity;
    private static FrameLayout overlay;
    private static LinearLayout quickBar;
    private static Rect startBtnRect = null;
    private static Rect bottomBarRect = null;
    private static final Map<String, Rect> cardBounds = new HashMap<String, Rect>();
    private static final Map<String, TextView> grips = new HashMap<String, TextView>();
    private static final String[] slotIds = new String[5];
    private static long revision;
    private static String draggingId;
    private static long dragRevision;
    private static float downX, downY;
    private static View ghost;
    private static boolean moved;
    private static boolean onMainScreen = true;
    private static boolean onSavedScreen = false;
    private static float grabOffsetX, grabOffsetY;

    private V44UiBridge(){}

    private static int dp(float value){
        if (activity == null) return (int) value;
        return (int)(activity.getResources().getDisplayMetrics().density * value + 0.5f);
    }

    private static String id(Object o){ return invokeString(o, "getId"); }
    private static String name(Object o){ return invokeString(o, "getName"); }

    private static String invokeString(Object o, String method){
        if (o == null) return "";
        try {
            Object value = o.getClass().getMethod(method).invoke(o);
            return value instanceof String ? (String) value : "";
        } catch(Exception e) {
            return "";
        }
    }

    private static List<Object> sessions(){
        try {
            Field f = Class.forName("com.tigeriq.layout.Manager").getDeclaredField("current");
            f.setAccessible(true);
            Object v = f.get(null);
            if (v instanceof List && !((List<?>) v).isEmpty()) {
                return new ArrayList<Object>((List<?>) v);
            }
        } catch(Exception ignored){}

        if (activity != null) {
            try {
                Method m = activity.getClass().getMethod("o");
                Object vm = m.invoke(activity);
                Field fn = vm.getClass().getDeclaredField("N");
                fn.setAccessible(true);
                Object stateFlow = fn.get(vm);
                Method gv = stateFlow.getClass().getMethod("getValue");
                Object state = gv.invoke(stateFlow);
                Field fk = state.getClass().getDeclaredField("k");
                fk.setAccessible(true);
                Object kList = fk.get(state);
                if (kList instanceof List && !((List<?>) kList).isEmpty()) {
                    return new ArrayList<Object>((List<?>) kList);
                }
            } catch(Exception ignored){}
        }
        return Collections.emptyList();
    }

    private static SharedPreferences prefs(){
        return activity.getSharedPreferences("tigeriq_v44_quick_slots", Context.MODE_PRIVATE);
    }

    public static void attach(final Activity a){
        if (a == null || a.isFinishing()) return;
        activity = a;

        try {
            Method m = Class.forName("com.tigeriq.layout.Manager").getDeclaredMethod("attach", Activity.class);
            m.setAccessible(true);
            m.invoke(null, a);
        } catch(Exception ignored){}

        revision++;
        cardBounds.clear();
        grips.clear();
        startBtnRect = null;
        bottomBarRect = null;
        draggingId = null;
        ghost = null;
        onMainScreen = true;
        onSavedScreen = false;

        a.runOnUiThread(() -> {
            FrameLayout content = (FrameLayout) a.findViewById(android.R.id.content);
            if (content == null) return;

            if (overlay != null && overlay.getParent() != null) {
                ((ViewGroup) overlay.getParent()).removeView(overlay);
            }

            overlay = new FrameLayout(a);
            overlay.setClickable(false);
            overlay.setFocusable(false);
            content.addView(overlay, new FrameLayout.LayoutParams(-1, -1));

            quickBar = new LinearLayout(a);
            quickBar.setOrientation(LinearLayout.HORIZONTAL);
            quickBar.setGravity(Gravity.CENTER);
            quickBar.setBackground(null);
            quickBar.setPadding(0, 0, 0, 0);

            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(246), dp(40), Gravity.BOTTOM | Gravity.LEFT);
            lp.leftMargin = dp(14);
            lp.bottomMargin = dp(100);
            quickBar.setLayoutParams(lp);
            quickBar.setVisibility(View.GONE);

            overlay.addView(quickBar);

            for (int i = 0; i < 5; i++) {
                slotIds[i] = prefs().getString("slot_" + i, "");
            }

            renderBar();
        });
    }

    public static boolean isSavedScreen(){ return onSavedScreen; }

    public static void onEnterHomeScreen(){
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            onMainScreen = true;
            onSavedScreen = false;
            if (quickBar != null) {
                repositionQuickBar();
                renderBar();
            }
            hideAllGrips();
        });
    }

    public static void onLeaveHomeScreen(){
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            onMainScreen = false;
            onSavedScreen = false;
            if (quickBar != null) {
                quickBar.setVisibility(View.GONE);
            }
        });
    }

    public static void onEnterSavedScreen(){
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            onMainScreen = false;
            onSavedScreen = true;
            if (quickBar != null) {
                quickBar.setVisibility(View.GONE);
            }
            for (Map.Entry<String, Rect> entry : cardBounds.entrySet()) {
                updateGrip(entry.getKey(), entry.getValue());
            }
            showAllGrips();
        });
    }

    public static void onCardPosition(final String uniqueId, final float windowX, final float windowY, final int w, final int h){
        if (activity == null || uniqueId == null || uniqueId.isEmpty()) return;
        if (Float.isNaN(windowX) || Float.isNaN(windowY) || Float.isInfinite(windowX) || Float.isInfinite(windowY)) return;
        if (w < dp(20) || h < dp(20)) return;

        activity.runOnUiThread(() -> {
            if (overlay == null) return;
            int[] origin = new int[2];
            overlay.getLocationInWindow(origin);
            int x = Math.round(windowX) - origin[0];
            int y = Math.round(windowY) - origin[1];
            Rect rect = new Rect(x, y, x + w, y + h);

            if ("__START_BUTTON__".equals(uniqueId)) {
                startBtnRect = rect;
                repositionQuickBar();
                return;
            }

            if ("__BOTTOM_BAR__".equals(uniqueId)) {
                bottomBarRect = rect;
                repositionQuickBar();
                return;
            }

            revision++;
            cardBounds.put(uniqueId, rect);
            updateGrip(uniqueId, rect);
        });
    }

    private static void repositionQuickBar(){
        if (quickBar == null || overlay == null) return;
        // Fail closed: no arbitrary position that can cover Samsung DeX controls.
        if (!onMainScreen || onSavedScreen || startBtnRect == null || bottomBarRect == null) {
            quickBar.setVisibility(View.GONE);
            return;
        }
        int gap = bottomBarRect.top - startBtnRect.bottom;
        int height = dp(40);
        if (gap < height + dp(4) || bottomBarRect.width() < dp(200)
            || bottomBarRect.left < 0 || startBtnRect.bottom < 0
            || bottomBarRect.top > overlay.getHeight()) {
            quickBar.setVisibility(View.GONE);
            return;
        }
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) quickBar.getLayoutParams();
        lp.gravity = Gravity.TOP | Gravity.LEFT;
        lp.leftMargin = bottomBarRect.left;
        lp.topMargin = startBtnRect.bottom + (gap - height) / 2;
        lp.bottomMargin = 0;
        lp.width = bottomBarRect.width();
        lp.height = height;
        quickBar.setLayoutParams(lp);
        quickBar.setVisibility(View.VISIBLE);
        quickBar.bringToFront();
    }

    private static void updateGrip(String uniqueId, Rect rect){
        if (overlay == null || activity == null) return;
        TextView grip = grips.get(uniqueId);
        if (grip == null) {
            grip = new TextView(activity);
            grip.setText("\u2630");
            grip.setTextSize(18);
            grip.setGravity(Gravity.CENTER);
            grip.setTextColor(Color.WHITE);

            GradientDrawable gbg = new GradientDrawable();
            gbg.setColor(0xDD242D3D);
            gbg.setCornerRadius(dp(8));
            gbg.setStroke(dp(1), 0x77FFFFFF);
            grip.setBackground(gbg);

            final String fixedId = uniqueId;
            grip.setOnTouchListener((v, e) -> onGrip(fixedId, e));

            overlay.addView(grip, new FrameLayout.LayoutParams(dp(40), dp(36)));
            grips.put(uniqueId, grip);
        }

        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) grip.getLayoutParams();
        lp.leftMargin = rect.right - dp(46);
        lp.topMargin = rect.top + dp(6);
        grip.setLayoutParams(lp);
        grip.setVisibility(onSavedScreen ? View.VISIBLE : View.GONE);
        grip.bringToFront();
    }

    private static void hideAllGrips(){
        for (TextView g : grips.values()) {
            if (g != null) g.setVisibility(View.GONE);
        }
    }

    private static void showAllGrips(){
        for (TextView g : grips.values()) {
            if (g != null) {
                g.setVisibility(View.VISIBLE);
                g.bringToFront();
            }
        }
    }

    private static boolean onGrip(String fixedId, MotionEvent event){
        if (overlay == null || !cardBounds.containsKey(fixedId)) return false;
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                endDrag();
                draggingId = fixedId;
                dragRevision = revision;
                downX = event.getRawX();
                downY = event.getRawY();
                Rect originRect = cardBounds.get(fixedId);
                int[] o = new int[2];
                overlay.getLocationOnScreen(o);
                grabOffsetX = originRect == null ? 0 : downX - o[0] - originRect.left;
                grabOffsetY = originRect == null ? 0 : downY - o[1] - originRect.top;
                return true;
            case MotionEvent.ACTION_MOVE:
                if (!fixedId.equals(draggingId)) return true;
                if (!moved && Math.hypot(event.getRawX() - downX, event.getRawY() - downY) > dp(8)) {
                    moved = true;
                    makeGhost(fixedId);
                }
                if (ghost != null) {
                    int[] pos = new int[2];
                    overlay.getLocationOnScreen(pos);
                    ghost.setX(event.getRawX() - pos[0] - grabOffsetX);
                    ghost.setY(event.getRawY() - pos[1] - grabOffsetY);
                }
                return true;
            case MotionEvent.ACTION_UP:
                if (moved && fixedId.equals(draggingId)) {
                    int[] pos = new int[2];
                    overlay.getLocationOnScreen(pos);
                    String target = exactTarget(event.getRawX() - pos[0], event.getRawY() - pos[1]);
                    if (target != null && !target.equals(fixedId)) {
                        shiftById(fixedId, target);
                    }
                }
                endDrag();
                return true;
            case MotionEvent.ACTION_CANCEL:
                endDrag();
                return true;
            default:
                return false;
        }
    }

    private static String exactTarget(float x, float y){
        Set<String> live = new HashSet<String>();
        for (Object o : sessions()) live.add(id(o));
        String found = null;
        for (Map.Entry<String, Rect> e : cardBounds.entrySet()) {
            if (!live.isEmpty() && !live.contains(e.getKey())) continue;
            Rect r = e.getValue();
            if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
                if (found != null) return null;
                found = e.getKey();
            }
        }
        return found;
    }

    private static void shiftById(String from, String to){
        try {
            List<Object> list = sessions();
            int target = -1;
            boolean source = false;
            for (int i = 0; i < list.size(); i++) {
                String x = id(list.get(i));
                if (from.equals(x)) source = true;
                if (to.equals(x)) target = i;
            }
            if (!source || target < 0) return;
            Class<?> m = Class.forName("com.tigeriq.layout.Manager");
            Method shift = m.getDeclaredMethod("shift", String.class, Integer.TYPE);
            shift.setAccessible(true);
            shift.invoke(null, from, target);
        } catch(Exception ignored){}
    }

    private static void makeGhost(String fixedId){
        Rect r = cardBounds.get(fixedId);
        if (r == null || overlay == null) return;
        int width = r.width(), height = r.height();
        if (width < 1 || height < 1 || width > 1200 || height > 1200) return;
        try {
            View parent = ((ViewGroup) activity.findViewById(android.R.id.content)).getChildAt(0);
            if (parent.getWidth() <= 0 || parent.getHeight() <= 0) return;
            if ((long) parent.getWidth() * parent.getHeight() > 8000000L) return;
            Bitmap whole = Bitmap.createBitmap(parent.getWidth(), parent.getHeight(), Bitmap.Config.ARGB_8888);
            parent.draw(new Canvas(whole));
            int[] overlayOrigin = new int[2];
            int[] contentOrigin = new int[2];
            overlay.getLocationOnScreen(overlayOrigin);
            parent.getLocationOnScreen(contentOrigin);
            int cropX = r.left + overlayOrigin[0] - contentOrigin[0];
            int cropY = r.top + overlayOrigin[1] - contentOrigin[1];
            int x = Math.max(0, Math.min(cropX, whole.getWidth() - 1));
            int y = Math.max(0, Math.min(cropY, whole.getHeight() - 1));
            int cw = Math.min(width, whole.getWidth() - x);
            int ch = Math.min(height, whole.getHeight() - y);
            if (cw < 1 || ch < 1) { whole.recycle(); return; }
            Bitmap cropped = Bitmap.createBitmap(whole, x, y, cw, ch);
            whole.recycle();
            ImageView view = new ImageView(activity);
            view.setImageBitmap(cropped);
            view.setAlpha(0.85f);
            view.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            overlay.addView(view, new FrameLayout.LayoutParams(cw, ch));
            ghost = view;
        } catch(Exception ignored) {
            TextView fallback = new TextView(activity);
            fallback.setText("\u2630");
            fallback.setTextColor(Color.WHITE);
            fallback.setBackgroundColor(0xE6333C50);
            overlay.addView(fallback, new FrameLayout.LayoutParams(dp(130), dp(44)));
            ghost = fallback;
        }
    }

    private static void endDrag(){
        if (ghost != null && overlay != null) {
            if (ghost instanceof ImageView) {
                Drawable d = ((ImageView) ghost).getDrawable();
                if (d instanceof BitmapDrawable) {
                    Bitmap b = ((BitmapDrawable) d).getBitmap();
                    if (b != null && !b.isRecycled()) b.recycle();
                }
                ((ImageView) ghost).setImageDrawable(null);
            }
            overlay.removeView(ghost);
        }
        ghost = null;
        draggingId = null;
        moved = false;
    }

    private static void openSlot(int i){
        if (activity == null || activity.isFinishing()) return;
        String selected = slotIds[i];
        if (selected == null || selected.trim().isEmpty()) {
            pickSlot(i);
            return;
        }
        try {
            Method m = activity.getClass().getMethod("o");
            Object vm = m.invoke(activity);
            Method j = vm.getClass().getMethod("j", String.class);
            j.invoke(vm, selected);
        } catch(Exception e) {
            Intent intent = new Intent(activity, activity.getClass());
            intent.putExtra("launch_session_id", selected);
            intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            activity.startActivity(intent);
        }
    }

    private static void pickSlot(final int slot){
        if (activity == null || activity.isFinishing()) return;

        final Dialog dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        GradientDrawable dialogBg = new GradientDrawable();
        dialogBg.setColor(0xF6171D28);
        dialogBg.setCornerRadius(dp(16));
        dialogBg.setStroke(dp(1), 0x335A6E8C);
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        }

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackground(dialogBg);
        root.setPadding(dp(16), dp(16), dp(16), dp(14));

        TextView title = new TextView(activity);
        title.setText("G\u00e1n ph\u00edm t\u1eaft nhanh " + (slot + 1));
        title.setTextColor(Color.WHITE);
        title.setTextSize(15.5f);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setPadding(dp(4), 0, 0, dp(12));
        root.addView(title);

        ScrollView scroll = new ScrollView(activity);
        LinearLayout list = new LinearLayout(activity);
        list.setOrientation(LinearLayout.VERTICAL);

        LinearLayout clearRow = createDialogRow(
            null,
            "\u2014 B\u1ecf g\u00e1n \u00f4 n\u00e0y \u2014",
            () -> {
                prefs().edit().putString("slot_" + slot, "").apply();
                slotIds[slot] = "";
                renderBar();
                dialog.dismiss();
                Toast.makeText(activity, "\u0110\u00e3 b\u1ecf g\u00e1n \u00f4 " + (slot + 1), Toast.LENGTH_SHORT).show();
            }
        );
        list.addView(clearRow);

        List<Object> sess = sessions();
        for (Object o : sess) {
            final String sid = id(o);
            if (sid == null || sid.isEmpty()) continue;
            final String layoutName = name(o);
            final Drawable ic = icon(o);

            LinearLayout row = createDialogRow(
                ic,
                layoutName,
                () -> {
                    prefs().edit().putString("slot_" + slot, sid).apply();
                    slotIds[slot] = sid;
                    renderBar();
                    dialog.dismiss();
                    Toast.makeText(activity, "\u0110\u00e3 g\u00e1n \u00f4 " + (slot + 1) + ": " + layoutName, Toast.LENGTH_SHORT).show();
                }
            );
            list.addView(row);
        }

        scroll.addView(list);
        LinearLayout.LayoutParams scrollLp = new LinearLayout.LayoutParams(-1, dp(260));
        root.addView(scroll, scrollLp);

        TextView btnClose = new TextView(activity);
        btnClose.setText("\u0110\u00f3ng");
        btnClose.setTextColor(0xFF8E9BAE);
        btnClose.setTextSize(14f);
        btnClose.setTypeface(Typeface.DEFAULT_BOLD);
        btnClose.setGravity(Gravity.RIGHT);
        btnClose.setPadding(dp(8), dp(12), dp(8), dp(4));
        btnClose.setOnClickListener(v -> dialog.dismiss());
        root.addView(btnClose);

        dialog.setContentView(root, new ViewGroup.LayoutParams(dp(360), -2));
        dialog.show();
    }

    private static LinearLayout createDialogRow(Drawable ic, String title, final Runnable onClick){
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(10), dp(8), dp(10), dp(8));
        row.setClickable(true);
        row.setFocusable(true);

        GradientDrawable rowBg = new GradientDrawable();
        rowBg.setColor(0x1AFFFFFF);
        rowBg.setCornerRadius(dp(10));
        rowBg.setStroke(dp(1), 0x1AFFFFFF);
        row.setBackground(rowBg);

        FrameLayout icWrap = new FrameLayout(activity);
        GradientDrawable icBg = new GradientDrawable();
        icBg.setColor(0x223B4A68);
        icBg.setCornerRadius(dp(8));
        icWrap.setBackground(icBg);

        ImageView img = new ImageView(activity);
        if (ic != null) {
            img.setImageDrawable(ic);
        } else {
            img.setImageResource(android.R.drawable.ic_menu_close_clear_cancel);
        }
        FrameLayout.LayoutParams imgLp = new FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER);
        icWrap.addView(img, imgLp);

        row.addView(icWrap, new LinearLayout.LayoutParams(dp(34), dp(34)));

        TextView titleView = new TextView(activity);
        titleView.setText(title);
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(13.5f);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titleView.setPadding(dp(12), 0, 0, 0);

        row.addView(titleView, new LinearLayout.LayoutParams(0, -2, 1f));

        row.setOnClickListener(v -> onClick.run());

        LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(-1, -2);
        rowLp.topMargin = dp(4);
        rowLp.bottomMargin = dp(4);
        row.setLayoutParams(rowLp);

        return row;
    }

    private static Drawable icon(Object o){
        try {
            Method m = Class.forName("com.tigeriq.layout.Manager").getDeclaredMethod("drawable", Object.class);
            m.setAccessible(true);
            Drawable d = (Drawable) m.invoke(null, o);
            if (d != null) return d;
        } catch(Exception ignored){}
        if (activity != null) {
            try {
                return activity.getApplicationInfo().loadIcon(activity.getPackageManager());
            } catch(Exception ignored){}
        }
        return null;
    }

    private static void renderBar(){
        if (overlay == null || activity == null || quickBar == null) return;
        Map<String,Object> items = new HashMap<String,Object>();
        for (Object o : sessions()) {
            String sid = id(o);
            if (sid.length() > 0) items.put(sid, o);
        }

        quickBar.removeAllViews();
        for (int i = 0; i < 5; i++) {
            final int slot = i;
            String sid = slotIds[slot];
            Object item = (sid != null && !sid.isEmpty()) ? items.get(sid) : null;

            LinearLayout cell = new LinearLayout(activity);
            cell.setOrientation(LinearLayout.VERTICAL);
            cell.setGravity(Gravity.CENTER);
            cell.setClickable(true);
            cell.setFocusable(true);
            cell.setBackground(null);

            if (item != null) {
                Drawable ic = icon(item);
                if (ic != null) {
                    ImageView img = new ImageView(activity);
                    img.setImageDrawable(ic);
                    img.setScaleType(ImageView.ScaleType.FIT_CENTER);
                    LinearLayout.LayoutParams imgLp = new LinearLayout.LayoutParams(dp(22), dp(22));
                    imgLp.gravity = Gravity.CENTER;
                    cell.addView(img, imgLp);
                }
                TextView label = new TextView(activity);
                label.setText(name(item));
                label.setTextColor(Color.WHITE);
                label.setTextSize(9.5f);
                label.setSingleLine(true);
                label.setEllipsize(TextUtils.TruncateAt.END);
                label.setGravity(Gravity.CENTER);
                cell.addView(label, new LinearLayout.LayoutParams(-1, dp(15)));
            } else {
                TextView slotPlus = new TextView(activity);
                slotPlus.setText(String.format(java.util.Locale.US, "+%02d", slot + 1));
                slotPlus.setTextColor(0x55FFFFFF);
                slotPlus.setTextSize(16f);
                slotPlus.setTypeface(Typeface.DEFAULT_BOLD);
                slotPlus.setGravity(Gravity.CENTER);
                cell.addView(slotPlus, new LinearLayout.LayoutParams(-1, -1));
            }

            cell.setOnClickListener(v -> openSlot(slot));
            cell.setOnLongClickListener(v -> { pickSlot(slot); return true; });

            LinearLayout.LayoutParams cellLp = new LinearLayout.LayoutParams(0, -1, 1f);
            cellLp.leftMargin = dp(2);
            cellLp.rightMargin = dp(2);
            quickBar.addView(cell, cellLp);
        }

        repositionQuickBar();
    }
}
