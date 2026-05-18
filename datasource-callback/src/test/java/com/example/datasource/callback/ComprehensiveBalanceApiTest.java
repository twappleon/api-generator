package com.example.datasource.callback;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * 综合余额API测试类
 * 测试不同参数组合和错误处理场景
 */
public class ComprehensiveBalanceApiTest {
    
    private static final String API_URL = "http://facai.hkpccfnewozt.xyz/tfghb/v1/api/balance";
    
    public static void main(String[] args) {
        System.out.println("=== 综合余额API测试 ===");
        
        // 测试不同参数组合
        testDifferentParameterCombinations();
        
        // 测试错误参数
        testInvalidParameters();
        
        // 测试性能
        testPerformance();
        
        System.out.println("=== 综合测试完成 ===");
    }
    
    /**
     * 测试不同参数组合
     */
    private static void testDifferentParameterCombinations() {
        System.out.println("\n=== 测试不同参数组合 ===");
        
        List<TestCase> testCases = Arrays.asList(
            new TestCase("fcstwleon2025082727939968", "VND", 22020, 1659405665545L, "原始参数"),
            new TestCase("testuser123", "USD", 10001, System.currentTimeMillis(), "USD货币"),
            new TestCase("testuser456", "EUR", 10002, System.currentTimeMillis(), "EUR货币"),
            new TestCase("testuser789", "VND", 10003, System.currentTimeMillis(), "不同游戏ID"),
            new TestCase("user001", "JPY", 10004, System.currentTimeMillis(), "JPY货币")
        );
        
        for (TestCase testCase : testCases) {
            System.out.println("\n测试案例: " + testCase.description);
            testApiCall(testCase.memberAccount, testCase.currency, testCase.gameId, testCase.timestamp);
        }
    }
    
    /**
     * 测试错误参数
     */
    private static void testInvalidParameters() {
        System.out.println("\n=== 测试错误参数处理 ===");
        
        List<TestCase> invalidCases = Arrays.asList(
            new TestCase("", "VND", 22020, 1659405665545L, "空账户名"),
            new TestCase("testuser", "", 22020, 1659405665545L, "空货币"),
            new TestCase("testuser", "VND", -1, 1659405665545L, "负数游戏ID"),
            new TestCase("testuser", "VND", 22020, -1L, "负数时间戳"),
            new TestCase("testuser", "INVALID_CURRENCY", 22020, 1659405665545L, "无效货币")
        );
        
        for (TestCase testCase : invalidCases) {
            System.out.println("\n错误测试: " + testCase.description);
            testApiCall(testCase.memberAccount, testCase.currency, testCase.gameId, testCase.timestamp);
        }
    }
    
    /**
     * 测试性能
     */
    private static void testPerformance() {
        System.out.println("\n=== 性能测试 ===");
        
        int testCount = 5;
        long totalTime = 0;
        List<Long> responseTimes = new ArrayList<>();
        
        for (int i = 0; i < testCount; i++) {
            long startTime = System.currentTimeMillis();
            
            try {
                String response = makeApiCall("fcstwleon2025082727939968", "VND", 22020, 1659405665545L);
                long endTime = System.currentTimeMillis();
                long responseTime = endTime - startTime;
                
                responseTimes.add(responseTime);
                totalTime += responseTime;
                
                System.out.println("  请求 " + (i + 1) + ": " + responseTime + "ms");
                
            } catch (Exception e) {
                System.out.println("  请求 " + (i + 1) + ": 失败 - " + e.getMessage());
            }
        }
        
        if (!responseTimes.isEmpty()) {
            long avgTime = totalTime / responseTimes.size();
            long minTime = Collections.min(responseTimes);
            long maxTime = Collections.max(responseTimes);
            
            System.out.println("\n性能统计:");
            System.out.println("  平均响应时间: " + avgTime + "ms");
            System.out.println("  最快响应时间: " + minTime + "ms");
            System.out.println("  最慢响应时间: " + maxTime + "ms");
            
            if (avgTime < 5000) {
                System.out.println("  ✓ 性能表现良好");
            } else {
                System.out.println("  ⚠ 响应时间较慢");
            }
        }
    }
    
    /**
     * 测试单个API调用
     */
    private static void testApiCall(String memberAccount, String currency, int gameId, long timestamp) {
        try {
            String response = makeApiCall(memberAccount, currency, gameId, timestamp);
            System.out.println("  ✓ 成功: " + response);
        } catch (Exception e) {
            System.out.println("  ✗ 失败: " + e.getMessage());
        }
    }
    
    /**
     * 执行API调用
     */
    private static String makeApiCall(String memberAccount, String currency, int gameId, long timestamp) throws Exception {
        URL url = new URL(API_URL);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        
        // 设置连接属性
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("User-Agent", "Java-Test-Client");
        connection.setDoOutput(true);
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(10000);
        
        // 构建请求体
        String requestBody = String.format(
            "{\n" +
            "  \"MemberAccount\": \"%s\",\n" +
            "  \"Currency\": \"%s\",\n" +
            "  \"GameID\": %d,\n" +
            "  \"Ts\": %d\n" +
            "}",
            memberAccount, currency, gameId, timestamp
        );
        
        // 发送请求
        try (OutputStream os = connection.getOutputStream()) {
            byte[] input = requestBody.getBytes(StandardCharsets.UTF_8);
            os.write(input, 0, input.length);
        }
        
        // 获取响应
        int responseCode = connection.getResponseCode();
        
        BufferedReader reader;
        if (responseCode >= 200 && responseCode < 300) {
            reader = new BufferedReader(new InputStreamReader(connection.getInputStream()));
        } else {
            reader = new BufferedReader(new InputStreamReader(connection.getErrorStream()));
        }
        
        StringBuilder response = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            response.append(line).append("\n");
        }
        reader.close();
        connection.disconnect();
        
        String responseBody = response.toString().trim();
        
        if (responseCode != 200) {
            throw new Exception("HTTP " + responseCode + ": " + responseBody);
        }
        
        return responseBody;
    }
    
    /**
     * 测试用例内部类
     */
    private static class TestCase {
        final String memberAccount;
        final String currency;
        final int gameId;
        final long timestamp;
        final String description;
        
        TestCase(String memberAccount, String currency, int gameId, long timestamp, String description) {
            this.memberAccount = memberAccount;
            this.currency = currency;
            this.gameId = gameId;
            this.timestamp = timestamp;
            this.description = description;
        }
    }
}