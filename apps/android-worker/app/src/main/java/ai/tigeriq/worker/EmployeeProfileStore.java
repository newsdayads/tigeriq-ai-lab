package ai.tigeriq.worker;

import android.content.Context;
import android.content.SharedPreferences;

/** Device-local non-secret employee identity/profile for the pilot worker. */
public final class EmployeeProfileStore {
    private static final String PREFS = "tigeriq-worker-profile";
    private static final String KEY_EMPLOYEE_ID = "employeeId";
    private static final String KEY_DEPARTMENT = "department";
    private static final String KEY_ROLE = "role";
    private static final String KEY_PROVIDER = "provider";

    private final SharedPreferences preferences;

    public EmployeeProfileStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public Profile load() {
        return new Profile(
            preferences.getString(KEY_EMPLOYEE_ID, "EMP-001"),
            preferences.getString(KEY_DEPARTMENT, "Research"),
            preferences.getString(KEY_ROLE, "Researcher"),
            preferences.getString(KEY_PROVIDER, "Gemini")
        );
    }

    public void save(String employeeId, String department, String role, String provider) {
        preferences.edit()
            .putString(KEY_EMPLOYEE_ID, clean(employeeId, "EMP-001"))
            .putString(KEY_DEPARTMENT, clean(department, "Research"))
            .putString(KEY_ROLE, clean(role, "Researcher"))
            .putString(KEY_PROVIDER, clean(provider, "Gemini"))
            .apply();
    }

    private static String clean(String value, String fallback) {
        if (value == null) return fallback;
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return fallback;
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
    }
}
