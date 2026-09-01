package ai.tigeriq.worker;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Pure deterministic policy for current-turn Gemini result boundaries and failure classification. */
final class GeminiTaskPolicy {
    static final long MIN_RESPONSE_AGE_MS = 4_500L;
    static final long RESPONSE_TIMEOUT_MS = 120_000L;

    private GeminiTaskPolicy() {}

    static String immediateFailure(String screen, String state, long ageMs) {
        String normalized = screen == null ? "" : screen.toLowerCase(Locale.ROOT);
        if (containsAny(normalized, "sign in", "đăng nhập", "choose an account", "chọn một tài khoản")) {
            return "LOGIN_REQUIRED";
        }
        if (containsAny(normalized, "try again later", "thử lại sau", "too many requests", "you've reached your limit", "đã đạt giới hạn")) {
            return "PROVIDER_LIMIT";
        }
        if ("SUBMITTED".equals(state) && ageMs > RESPONSE_TIMEOUT_MS) {
            return "TIMEOUT";
        }
        return "";
    }

    static Set<String> baselineHashes(List<String> orderedTexts, String prompt) {
        LinkedHashSet<String> hashes = new LinkedHashSet<>();
        if (orderedTexts == null) return hashes;
        for (String value : orderedTexts) {
            String candidate = value == null ? "" : value.trim();
            if (isUsefulResultText(candidate, prompt)) hashes.add(hash(candidate));
        }
        return hashes;
    }

    static List<String> currentTurnCandidates(List<String> orderedTexts, String prompt, Set<String> baselineHashes) {
        ArrayList<String> result = new ArrayList<>();
        if (orderedTexts == null || orderedTexts.isEmpty()) return result;
        String normalizedPrompt = comparable(prompt);
        if (normalizedPrompt.isEmpty()) return result;

        int anchor = -1;
        for (int i = 0; i < orderedTexts.size(); i++) {
            if (normalizedPrompt.equals(comparable(orderedTexts.get(i)))) anchor = i;
        }
        if (anchor < 0) return result;

        Set<String> baseline = baselineHashes == null ? new HashSet<>() : baselineHashes;
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        for (int i = anchor + 1; i < orderedTexts.size(); i++) {
            String candidate = orderedTexts.get(i) == null ? "" : orderedTexts.get(i).trim();
            if (!isUsefulResultText(candidate, prompt)) continue;
            String digest = hash(candidate);
            if (baseline.contains(digest) || !seen.add(digest)) continue;
            result.add(candidate);
        }
        return result;
    }

    static boolean completionReady(long ageMs, int baselineMarkerCount, int currentMarkerCount, List<String> newTexts) {
        if (ageMs < MIN_RESPONSE_AGE_MS) return false;
        if (baselineMarkerCount < 0 || currentMarkerCount <= baselineMarkerCount) return false;
        if (newTexts == null || newTexts.isEmpty()) return false;
        int total = 0;
        for (String text : newTexts) {
            if (text != null) total += text.trim().length();
            if (total >= 40) return true;
        }
        return false;
    }

    static boolean resumableSubmitted(String state, boolean boundaryCaptured) {
        return "SUBMITTED".equals(state) && boundaryCaptured;
    }

    static String joinBounded(List<String> texts, int maxChars) {
        if (texts == null || texts.isEmpty()) return "";
        StringBuilder out = new StringBuilder();
        for (String text : texts) {
            if (text == null || text.trim().isEmpty()) continue;
            if (out.length() > 0) out.append("\n\n");
            out.append(text.trim());
            if (out.length() >= maxChars) break;
        }
        if (out.length() > maxChars) out.setLength(maxChars);
        return out.toString().trim();
    }

    static boolean isUsefulResultText(String candidate, String prompt) {
        if (candidate == null || candidate.trim().length() < 20) return false;
        if (!comparable(prompt).isEmpty() && comparable(candidate).equals(comparable(prompt))) return false;
        String n = candidate.toLowerCase(Locale.ROOT);
        return !containsAny(n,
            "gemini", "new chat", "cuộc trò chuyện mới", "send", "gửi", "copy", "sao chép",
            "share", "chia sẻ", "listen", "nghe", "good response", "bad response",
            "google", "menu", "history", "lịch sử", "regenerate", "tạo lại");
    }

    static String hash(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest((value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) out.append(String.format(Locale.ROOT, "%02x", b & 0xff));
            return out.toString();
        } catch (Exception impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private static String comparable(String value) {
        if (value == null) return "";
        return value.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }

    private static boolean containsAny(String haystack, String... needles) {
        for (String needle : needles) if (haystack.contains(needle)) return true;
        return false;
    }
}
