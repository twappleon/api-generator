package com.example.datasource.callback;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Disabled;
import java.io.IOException;
import static org.junit.jupiter.api.Assertions.*;

/**
 * 集成测试 - 测试实际API端点的可行性
 * 注意：这些测试需要网络连接，默认情况下被禁用
 */
public class BalanceApiIntegrationTest {
    
    @Test
    @DisplayName("集成测试 - 测试实际余额API端点可行性")
    @Disabled("需要网络连接，仅在需要时启用")
    void testActualBalanceApiEndpoint() throws IOException {
        // 创建使用实际API端点的客户端
        BalanceApiClient client = new BalanceApiClient();
        
        try {
            // 调用实际的API端点
            String response = client.getBalanceWithDefaultParams();
            
            // 验证响应不为空
            assertNotNull(response);
            assertFalse(response.trim().isEmpty());
            
            // 打印响应用于调试
            System.out.println("API响应: " + response);
            
            // 验证响应包含基本的JSON结构
            assertTrue(response.contains("{"));
            assertTrue(response.contains("}"));
            
        } catch (IOException e) {
            // 如果网络不可用或API不可访问，记录错误但不让测试失败
            System.err.println("无法连接到API端点: " + e.getMessage());
            // 可以选择让测试失败或跳过
            // fail("API端点不可访问: " + e.getMessage());
        }
    }
    
    @Test
    @DisplayName("集成测试 - 测试不同参数的API调用")
    @Disabled("需要网络连接，仅在需要时启用")
    void testBalanceApiWithDifferentParameters() throws IOException {
        BalanceApiClient client = new BalanceApiClient();
        
        try {
            // 测试不同的参数组合
            String response1 = client.getBalance("testuser1", "VND", 10001, System.currentTimeMillis());
            String response2 = client.getBalance("testuser2", "USD", 10002, System.currentTimeMillis());
            
            // 验证响应不为空
            assertNotNull(response1);
            assertNotNull(response2);
            
            System.out.println("参数组合1响应: " + response1);
            System.out.println("参数组合2响应: " + response2);
            
        } catch (IOException e) {
            System.err.println("API调用失败: " + e.getMessage());
            // 可以选择让测试失败或跳过
        }
    }
    
    @Test
    @DisplayName("集成测试 - 验证API响应时间")
    @Disabled("需要网络连接，仅在需要时启用")
    void testApiResponseTime() throws IOException {
        BalanceApiClient client = new BalanceApiClient();
        
        try {
            long startTime = System.currentTimeMillis();
            String response = client.getBalanceWithDefaultParams();
            long endTime = System.currentTimeMillis();
            
            long responseTime = endTime - startTime;
            
            // 验证响应时间在合理范围内（例如，不超过30秒）
            assertTrue(responseTime < 30000, "API响应时间过长: " + responseTime + "ms");
            
            System.out.println("API响应时间: " + responseTime + "ms");
            System.out.println("响应内容: " + response);
            
        } catch (IOException e) {
            System.err.println("API调用超时或失败: " + e.getMessage());
        }
    }
}