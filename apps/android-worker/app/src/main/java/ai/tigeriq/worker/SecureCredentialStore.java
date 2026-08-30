package ai.tigeriq.worker;

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

/** Stores the scoped node credential encrypted with a non-exportable Android Keystore AES key. */
public final class SecureCredentialStore {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "tigeriq-worker-credential-v1";
    private static final String PREFS = "tigeriq-worker-secure";
    private static final String KEY_CONTROLLER = "controller";
    private static final String KEY_CREDENTIAL = "credential";
    private static final String KEY_TOKEN = "token";

    private final Context context;

    public SecureCredentialStore(Context context) {
        this.context = context.getApplicationContext();
    }

    public void save(String controllerUrl, String credentialId, String token) throws Exception {
        if (controllerUrl == null || !controllerUrl.startsWith("https://")) {
            throw new IllegalArgumentException("controller URL must use HTTPS");
        }
        if (credentialId == null || credentialId.trim().isEmpty() || token == null || token.isEmpty()) {
            throw new IllegalArgumentException("credentialId and token are required");
        }
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(KEY_CONTROLLER, encrypt(controllerUrl))
            .putString(KEY_CREDENTIAL, encrypt(credentialId))
            .putString(KEY_TOKEN, encrypt(token))
            .apply();
    }

    public Credential load() throws Exception {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String controller = prefs.getString(KEY_CONTROLLER, null);
        String credential = prefs.getString(KEY_CREDENTIAL, null);
        String token = prefs.getString(KEY_TOKEN, null);
        if (controller == null || credential == null || token == null) return null;
        return new Credential(decrypt(controller), decrypt(credential), decrypt(token));
    }

    public void clear() {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    private String encrypt(String plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." + Base64.encodeToString(ciphertext, Base64.NO_WRAP);
    }

    private String decrypt(String encoded) throws Exception {
        String[] parts = encoded.split("\\.", 2);
        if (parts.length != 2) throw new IllegalStateException("invalid encrypted credential");
        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
        byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    public static final class Credential {
        public final String controllerUrl;
        public final String credentialId;
        public final String token;

        Credential(String controllerUrl, String credentialId, String token) {
            this.controllerUrl = controllerUrl;
            this.credentialId = credentialId;
            this.token = token;
        }
    }
}
