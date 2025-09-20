package com.example.datasource.callback;

import okhttp3.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * Client for calling the balance API
 */
public class BalanceApiClient {
    
    private final OkHttpClient client;
    private final ObjectMapper objectMapper;
    private final String baseUrl;
    
    public BalanceApiClient() {
        this.client = new OkHttpClient().newBuilder().build();
        this.objectMapper = new ObjectMapper();
        this.baseUrl = "http://facai.hkpccfnewozt.xyz/tfghb/v1/api/balance";
    }
    
    public BalanceApiClient(String baseUrl) {
        this.client = new OkHttpClient().newBuilder().build();
        this.objectMapper = new ObjectMapper();
        this.baseUrl = baseUrl;
    }
    
    /**
     * Calls the balance API with the provided parameters
     * @param memberAccount The member account ID
     * @param currency The currency code (e.g., "VND")
     * @param gameId The game ID
     * @param timestamp The timestamp
     * @return The API response as a string
     * @throws IOException if the request fails
     */
    public String getBalance(String memberAccount, String currency, int gameId, long timestamp) throws IOException {
        // Create request body
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("MemberAccount", memberAccount);
        requestBody.put("Currency", currency);
        requestBody.put("GameID", gameId);
        requestBody.put("Ts", timestamp);
        
        String jsonBody = objectMapper.writeValueAsString(requestBody);
        
        MediaType mediaType = MediaType.parse("application/json");
        RequestBody body = RequestBody.create(mediaType, jsonBody);
        
        // Build request
        Request request = new Request.Builder()
                .url(baseUrl)
                .method("POST", body)
                .addHeader("Content-Type", "application/json")
                .build();
        
        // Execute request
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Unexpected code " + response);
            }
            return response.body().string();
        }
    }
    
    /**
     * Calls the balance API with default test parameters
     * @return The API response as a string
     * @throws IOException if the request fails
     */
    public String getBalanceWithDefaultParams() throws IOException {
        return getBalance("fcstwleon2025082727939968", "VND", 22020, 1659405665545L);
    }
}