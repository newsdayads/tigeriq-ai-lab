// V66 TEST-only Java bridge repair. Source transformation, never writes PC01 or signs APK.
// Apply to the exact owner-approved Java source after an authorized host preflight.
export function patchNativeGripReorder(source) {
  if (typeof source !== 'string' || !source.includes('private static void repairMissingGrips(){') ||
      !source.includes('private static boolean onGrip(String fixedId, MotionEvent event){')) {
    throw Error('SOURCE_BRIDGE_NOT_RECOGNIZED');
  }
  const replaceSection = (start, end, value) => {
    const i = source.indexOf(start);
    const j = source.indexOf(end, i + start.length);
    if (i < 0 || j < 0 || source.indexOf(start, i+1) !== -1) throw Error('SOURCE_ANCHOR_MISMATCH:' + start);
    source = source.slice(0, i) + value + '\n\n' + source.slice(j);
  };
  const anchor = '    private static final Map<String, Rect> cardBounds = new HashMap<String, Rect>();';
  if (source.split(anchor).length !== 2) throw Error('CARD_MAP_ANCHOR_MISMATCH');
  source = source.replace(anchor, anchor + '\n    // Frozen native-card geometry for the lifetime of ONE pointer gesture.\n    private static final Map<String, Rect> dragSnapshotBounds = new HashMap<String, Rect>();');
  replaceSection('    // When Compose does not emit per-card placement events,',
    '    public static void onCardPosition(',
`    // No proportional 3x2 fallback: it places grips on the wrong DeX panel.
    // Only CardPositioned Compose onGloballyPositioned callbacks may supply bounds.
    private static void repairMissingGrips(){
        if (!onSavedScreen || overlay == null || draggingId != null) return;
        hideAllGrips();
        int w = overlay.getWidth(), h = overlay.getHeight();
        if (w <= 0 || h <= 0) return;
        for (Object obj : sessions()) {
            String sid = id(obj);
            Rect r = cardBounds.get(sid);
            if (r == null || r.width() < dp(40) || r.height() < dp(40) ||
                    r.left < 0 || r.top < 0 || r.right > w || r.bottom > h) continue;
            updateGrip(sid, r);
        }
    }`);
  const callbackAnchor = `            revision++;
            cardBounds.put(uniqueId, rect);
            updateGrip(uniqueId, rect);`;
  if (source.split(callbackAnchor).length !== 2) throw Error('NATIVE_CALLBACK_ANCHOR_MISMATCH');
  source = source.replace(callbackAnchor,`            // Only real visible Compose card bounds are admitted; freeze during drag.
            if (!onSavedScreen || draggingId != null) return;
            int maxW = overlay.getWidth(), maxH = overlay.getHeight();
            if (rect.width() < dp(40) || rect.height() < dp(40) ||
                    rect.left < 0 || rect.top < 0 ||
                    rect.right > maxW || rect.bottom > maxH) return;
            revision++;
            cardBounds.put(uniqueId, rect);
            repairMissingGrips();`);
  replaceSection('    private static boolean onGrip(String fixedId, MotionEvent event){',
    '    private static String exactTarget(',
`    private static boolean onGrip(String fixedId, MotionEvent event){
        if (!onSavedScreen || overlay == null) return false;
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                if (!cardBounds.containsKey(fixedId)) return false;
                endDrag();
                dragSnapshotBounds.clear();
                for (Object o : sessions()) {
                    String sid = id(o);
                    Rect measured = cardBounds.get(sid);
                    if (measured != null && measured.width() >= dp(40) &&
                        measured.height() >= dp(40) &&
                        measured.left >= 0 && measured.top >= 0 &&
                        measured.right <= overlay.getWidth() &&
                        measured.bottom <= overlay.getHeight()) {
                        dragSnapshotBounds.put(sid, new Rect(measured));
                    }
                }
                Rect originRect = dragSnapshotBounds.get(fixedId);
                if (originRect == null || dragSnapshotBounds.size() < 2) return false;
                draggingId = fixedId;
                dragRevision = revision;
                downX = event.getRawX();
                downY = event.getRawY();
                int[] origin = new int[2];
                overlay.getLocationOnScreen(origin);
                grabOffsetX = Math.max(0, Math.min(originRect.width(),
                    downX - origin[0] - originRect.left));
                grabOffsetY = Math.max(0, Math.min(originRect.height(),
                    downY - origin[1] - originRect.top));
                return true;
            case MotionEvent.ACTION_MOVE:
                if (!fixedId.equals(draggingId)) return true;
                if (!moved && Math.hypot(event.getRawX() - downX,
                    event.getRawY() - downY) > dp(8)) {
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
                String target = null;
                if (moved && fixedId.equals(draggingId)) {
                    int[] pos = new int[2];
                    overlay.getLocationOnScreen(pos);
                    target = exactTarget(event.getRawX() - pos[0],
                        event.getRawY() - pos[1]);
                }
                endDrag();
                if (target != null && !target.equals(fixedId)) {
                    // Old card-ID positions are INVALID after a reorder.
                    cardBounds.clear();
                    hideAllGrips();
                    shiftById(fixedId, target);
                }
                return true;
            case MotionEvent.ACTION_CANCEL:
                endDrag();
                return true;
            default:
                return false;
        }
    }`);
  replaceSection('    private static String exactTarget(float x, float y){',
    '    private static void shiftById(',
`    private static String exactTarget(float x, float y){
        if (draggingId == null) return null;
        String found = null;
        for (Map.Entry<String,Rect> e : dragSnapshotBounds.entrySet()) {
            Rect r = e.getValue();
            if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
                // Native rectangles must never overlap, or this drop is refused.
                if (found != null) return null;
                found = e.getKey();
            }
        }
        return found;
    }`);
  replaceSection('    private static void makeGhost(String fixedId){',
    '    private static void endDrag(',
`    private static void makeGhost(String fixedId){
        Rect r = dragSnapshotBounds.get(fixedId);
        if (r == null || overlay == null || activity == null) return;
        // Avoid copying/cropping the entire DeX window into a misplaced ghost.
        TextView preview = new TextView(activity);
        preview.setText("\\u2630  Đang di chuyển");
        preview.setTextColor(Color.WHITE);
        preview.setTextSize(16);
        preview.setGravity(Gravity.CENTER);
        preview.setBackgroundColor(0xC0242D3D);
        preview.setAlpha(0.85f);
        preview.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        overlay.addView(preview, new FrameLayout.LayoutParams(r.width(), r.height()));
        preview.setX(r.left);
        preview.setY(r.top);
        ghost = preview;
    }`);
  const cleanAnchor = '        draggingId = null;\n        moved = false;\n    }';
  if (source.split(cleanAnchor).length !== 2) throw Error('END_DRAG_ANCHOR_MISMATCH');
  source = source.replace(cleanAnchor, '        draggingId = null;\n        moved = false;\n        dragSnapshotBounds.clear();\n    }');
  if (source.includes('int firstTop = Math.round(height * 0.155f)') ||
      source.includes('Bitmap whole = Bitmap.createBitmap(')) throw Error('UNSAFE_OLD_GEOMETRY_PRESENT');
  return source;
}
