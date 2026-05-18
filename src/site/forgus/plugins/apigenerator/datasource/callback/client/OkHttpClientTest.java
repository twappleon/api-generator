package site.forgus.plugins.apigenerator.datasource.callback.client;

import okhttp3.*;
import site.forgus.plugins.apigenerator.datasource.callback.config.ApiConfig;
import site.forgus.plugins.apigenerator.datasource.callback.model.BalanceRequest;
import site.forgus.plugins.apigenerator.datasource.callback.model.BalanceResponse;
import site.forgus.plugins.apigenerator.util.JsonUtil;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

/**
 * OkHttpClient Test Case for Balance API
 * OkHttpClient 余额API测试用例
 */
public class OkHttpClientTest {
    
    private final OkHttpClient client;
    private final MediaType JSON_MEDIA_TYPE = MediaType.parse(ApiConfig.CONTENT_TYPE_JSON);
    
    /**
     * Constructor with default configuration
     */
    public OkHttpClientTest() {
        this.client = new OkHttpClient.Builder()
                .connectTimeout(ApiConfig.CONNECTION_TIMEOUT, TimeUnit.MILLISECONDS)
                .readTimeout(ApiConfig.READ_TIMEOUT, TimeUnit.MILLISECONDS)
                .writeTimeout(ApiConfig.WRITE_TIMEOUT, TimeUnit.MILLISECONDS)
                .addInterceptor(new LoggingInterceptor())
                .build();
    }
    
    /**
     * Constructor with custom OkHttpClient
     */
    public OkHttpClientTest(OkHttpClient client) {
        this.client = client;
    }
    
    /**
     * Test balance API with default parameters
     */
    public BalanceResponse testBalanceApiDefault() throws IOException {
        BalanceRequest request = BalanceRequest.builder()
                .memberAccount(ApiConfig.TEST_MEMBER_ACCOUNT)
                .currency(ApiConfig.TEST_CURRENCY)
                .gameID(ApiConfig.TEST_GAME_ID)
                .ts(ApiConfig.getCurrentTimestamp())
                .build();
        
        return testBalanceApi(request);
    }
    
    /**
     * Test balance API with custom request
     */
    public BalanceResponse testBalanceApi(BalanceRequest balanceRequest) throws IOException {
        // Convert request object to JSON
        String jsonRequest = JsonUtil.toJson(balanceRequest);
        System.out.println("Request JSON: " + jsonRequest);
        
        // Create request body
        RequestBody body = RequestBody.create(JSON_MEDIA_TYPE, jsonRequest);
        
        // Build HTTP request
        Request request = new Request.Builder()
                .url(ApiConfig.getBalanceUrl())
                .method("POST", body)
                .addHeader("Content-Type", ApiConfig.CONTENT_TYPE_JSON)
                .addHeader("Accept", ApiConfig.CONTENT_TYPE_JSON)
                .addHeader("User-Agent", "OkHttpClient-Test/1.0")
                .build();
        
        // Execute request
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Unexpected response code: " + response.code() + 
                                    ", message: " + response.message());
            }
            
            // Parse response body
            String responseBody = response.body() != null ? response.body().string() : "";
            System.out.println("Response Body: " + responseBody);
            
            // Convert JSON to response object
            BalanceResponse balanceResponse = JsonUtil.fromJson(responseBody, BalanceResponse.class);
            
            // Log response details
            logResponse(response, balanceResponse);
            
            return balanceResponse;
        }
    }
    
    /**
     * Test balance API with original format (as provided in the requirement)
     */
    public String testBalanceApiOriginalFormat() throws IOException {
        // Using the exact format from the requirement
        OkHttpClient client = new OkHttpClient().newBuilder()
                .build();
        
        MediaType mediaType = MediaType.parse("application/json");
        RequestBody body = RequestBody.create(mediaType, 
            "{\n" +
            "  \"MemberAccount\": \"fcstwleon2025082727939968\",\n" +
            "  \"Currency\": \"VND\",\n" +
            "  \"GameID\": 22020,\n" +
            "  \"Ts\": " + System.currentTimeMillis() + "\n" +
            "}");
        
        Request request = new Request.Builder()
                .url("http://facai.hkpccfnewozt.xyz/tfghb/v1/api/balance")
                .method("POST", body)
                .addHeader("Content-Type", "application/json")
                .build();
        
        try (Response response = client.newCall(request).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            System.out.println("Original Format Test Response: " + responseBody);
            return responseBody;
        }
    }
    
    /**
     * Test balance API asynchronously
     */
    public void testBalanceApiAsync(BalanceRequest balanceRequest, Callback callback) {
        String jsonRequest = JsonUtil.toJson(balanceRequest);
        RequestBody body = RequestBody.create(JSON_MEDIA_TYPE, jsonRequest);
        
        Request request = new Request.Builder()
                .url(ApiConfig.getBalanceUrl())
                .post(body)
                .addHeader("Content-Type", ApiConfig.CONTENT_TYPE_JSON)
                .build();
        
        client.newCall(request).enqueue(callback);
    }
    
    /**
     * Test with retry mechanism
     */
    public BalanceResponse testBalanceApiWithRetry(BalanceRequest balanceRequest, int maxRetries) 
            throws IOException {
        IOException lastException = null;
        
        for (int i = 0; i <= maxRetries; i++) {
            try {
                System.out.println("Attempt " + (i + 1) + " of " + (maxRetries + 1));
                return testBalanceApi(balanceRequest);
            } catch (IOException e) {
                lastException = e;
                System.err.println("Request failed on attempt " + (i + 1) + ": " + e.getMessage());
                
                if (i < maxRetries) {
                    try {
                        Thread.sleep(1000 * (i + 1)); // Exponential backoff
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new IOException("Interrupted during retry", ie);
                    }
                }
            }
        }
        
        throw new IOException("All retry attempts failed", lastException);
    }
    
    /**
     * Log response details
     */
    private void logResponse(Response response, BalanceResponse balanceResponse) {
        System.out.println("=== Response Details ===");
        System.out.println("HTTP Code: " + response.code());
        System.out.println("HTTP Message: " + response.message());
        System.out.println("Headers: " + response.headers());
        
        if (balanceResponse != null) {
            System.out.println("Response Code: " + balanceResponse.getCode());
            System.out.println("Response Message: " + balanceResponse.getMessage());
            System.out.println("Is Success: " + balanceResponse.isSuccess());
            
            if (balanceResponse.getData() != null) {
                System.out.println("Balance Data: " + balanceResponse.getData());
            }
        }
        System.out.println("========================");
    }
    
    /**
     * Logging interceptor for debugging
     */
    private static class LoggingInterceptor implements Interceptor {
        @Override
        public Response intercept(Chain chain) throws IOException {
            Request request = chain.request();
            
            long t1 = System.nanoTime();
            System.out.println(String.format("Sending request %s on %s%n%s",
                    request.url(), chain.connection(), request.headers()));
            
            Response response = chain.proceed(request);
            
            long t2 = System.nanoTime();
            System.out.println(String.format("Received response for %s in %.1fms%n%s",
                    response.request().url(), (t2 - t1) / 1e6d, response.headers()));
            
            return response;
        }
    }
    
    /**
     * Close the client
     */
    public void close() {
        client.dispatcher().executorService().shutdown();
        client.connectionPool().evictAll();
    }
}