package your.pkg;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Duration;

class DatasourceCallbackBalanceTest {

    private static OkHttpClient client;

    @BeforeAll
    static void setUp() {
        client = new OkHttpClient.Builder()
                .callTimeout(Duration.ofSeconds(20))
                .connectTimeout(Duration.ofSeconds(10))
                .readTimeout(Duration.ofSeconds(20))
                .build();
    }

    @Test
    void balanceApi_shouldRespondSuccessfully() throws IOException {
        String url = System.getProperty(
                "BALANCE_URL",
                "http://facai.hkpccfnewozt.xyz/tfghb/v1/api/balance"
        );

        MediaType mediaType = MediaType.parse("application/json");
        String payload = "{\n" +
                "  \\\"MemberAccount\\\": \\\"fcstwleon2025082727939968\\\",\n" +
                "  \\\"Currency\\\": \\\"VND\\\",\n" +
                "  \\\"GameID\\\": 22020,\n" +
                "  \\\"Ts\\\": 1659405665545\n" +
                "}";

        RequestBody body = RequestBody.create(mediaType, payload);
        Request request = new Request.Builder()
                .url(url)
                .post(body)
                .addHeader("Content-Type", "application/json")
                .build();

        try (Response response = client.newCall(request).execute()) {
            Assertions.assertTrue(response.isSuccessful(),
                    "HTTP " + response.code() + " - " + response.message());
            String responseBody = response.body() != null ? response.body().string() : "";
            System.out.println("Response body: " + responseBody);
            Assertions.assertFalse(responseBody.isEmpty(), "Empty response body");
        }
    }
}

