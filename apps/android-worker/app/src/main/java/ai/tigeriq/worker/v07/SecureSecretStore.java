package ai.tigeriq.worker.v07;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Keystore-backed encrypted local secrets. Controller V1 has no Android bootstrap/session secret. */
public final class SecureSecretStore {
    public static final String FCM_TOKEN = "fcm_token";
    private static final String PREFS = "tigeriq_v07_secure";
    private static final String KEY_ALIAS = "tigeriq.v07.secure.aes";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private final SharedPreferences prefs;

    public SecureSecretStore(Context context) { prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    public synchronized void put(String name, String value) throws Exception {
        if (name == null || name.isBlank()) throw new IllegalArgumentException("secret name required");
        if (value == null) { remove(name); return; }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, ensureKey());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        String packed = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP);
        if (!prefs.edit().putString(name, packed).commit()) throw new IllegalStateException("cannot persist encrypted secret");
    }

    public synchronized String get(String name) throws Exception {
        String packed = prefs.getString(name, null);
        if (packed == null) return null;
        int split = packed.indexOf('.');
        if (split <= 0 || split == packed.length() - 1) throw new IllegalStateException("invalid encrypted secret");
        byte[] iv = Base64.decode(packed.substring(0, split), Base64.NO_WRAP);
        byte[] encrypted = Base64.decode(packed.substring(split + 1), Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, ensureKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    public synchronized void putLong(String name, long value) throws Exception { put(name, Long.toString(value)); }
    public synchronized long getLong(String name, long fallback) throws Exception { String value = get(name); if (value == null) return fallback; try { return Long.parseLong(value); } catch (NumberFormatException ignored) { return fallback; } }
    public synchronized void remove(String name) { prefs.edit().remove(name).commit(); }
    public synchronized void removeJobSecrets(String jobId) { prefs.edit().remove(leaseKey(jobId)).remove(jobKey(jobId)).remove(resultKey(jobId)).commit(); }
    public static String leaseKey(String jobId) { return "lease:" + jobId; }
    public static String jobKey(String jobId) { return "job:" + jobId; }
    public static String resultKey(String jobId) { return "result:" + jobId; }

    private SecretKey ensureKey() throws Exception {
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE); store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
}
