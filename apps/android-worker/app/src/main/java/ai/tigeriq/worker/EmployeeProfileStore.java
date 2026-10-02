package ai.tigeriq.worker;

import android.content.Context;
import android.content.SharedPreferences;

/** Device-local non-secret worker assignment/profile for the pilot. */
public final class EmployeeProfileStore {
    private static final String PREFS = "tigeriq-worker-profile";
    private static final String KEY_EMPLOYEE_ID = "employeeId";
    private static final String KEY_DEPARTMENT = "department";
    private static final String KEY_ROLE = "role";
    private static final String KEY_PROVIDER = "provider";
    private static final String KEY_V06_MIGRATED = "v06Migrated";

    private final SharedPreferences preferences;

    public EmployeeProfileStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        migrateLegacyProbeDefaults();
    }

    public Profile load() {
        return new Profile(
            cleanOrEmpty(preferences.getString(KEY_EMPLOYEE_ID, "")),
            cleanOrEmpty(preferences.getString(KEY_DEPARTMENT, "")),
            cleanOrEmpty(preferences.getString(KEY_ROLE, "")),
            normalizeProvider(preferences.getString(KEY_PROVIDER, "ChatGPT"))
        );
    }

    public void saveProvider(String provider) {
        preferences.edit().putString(KEY_PROVIDER, normalizeProvider(provider)).apply();
    }

    public void saveAssignedEmployee(String employeeId, String department, String role, String provider) {
        preferences.edit()
            .putString(KEY_EMPLOYEE_ID, cleanOrEmpty(employeeId))
            .putString(KEY_DEPARTMENT, cleanOrEmpty(department))
            .putString(KEY_ROLE, cleanOrEmpty(role))
            .putString(KEY_PROVIDER, normalizeProvider(provider))
            .apply();
    }

    private void migrateLegacyProbeDefaults() {
        if (preferences.getBoolean(KEY_V06_MIGRATED, false)) return;
        String employeeId = preferences.getString(KEY_EMPLOYEE_ID, "");
        String department = preferences.getString(KEY_DEPARTMENT, "");
        String role = preferences.getString(KEY_ROLE, "");
        String provider = preferences.getString(KEY_PROVIDER, "");
        SharedPreferences.Editor editor = preferences.edit().putBoolean(KEY_V06_MIGRATED, true);

        // v0.5 showed these as if they were a real assignment. Clear only the exact probe defaults.
        if ("EMP-001".equals(employeeId) && "Research".equals(department) && "Researcher".equals(role)) {
            editor.remove(KEY_EMPLOYEE_ID).remove(KEY_DEPARTMENT).remove(KEY_ROLE);
            if ("Gemini".equalsIgnoreCase(provider)) editor.putString(KEY_PROVIDER, "ChatGPT");
        }
        editor.apply();
    }

    static String normalizeProvider(String value) {
        if (value != null && "Gemini".equalsIgnoreCase(value.trim())) return "Gemini";
        return "ChatGPT";
    }

    private static String cleanOrEmpty(String value) {
        if (value == null) return "";
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return "";
        return trimmed.length() > 80 ? trimmed.substring(0, 80) : trimmed;
    }

    public static final class Profile {
        public final String employeeId;
        public final String department;
        public final String role;
        public final String provider;

        Profile(String employeeId, String department, String role, String provider) {
            this.employeeId = employeeId;
            this.department = department;
            this.role = role;
            this.provider = provider;
        }

        public boolean assigned() {
            return !employeeId.isEmpty() && !department.isEmpty() && !role.isEmpty();
        }
    }
}
