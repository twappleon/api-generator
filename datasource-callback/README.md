# DataSource Callback Module

这个模块用于测试余额API调用的可行性。

## 功能

- 提供 `BalanceApiClient` 类来调用余额API
- 包含完整的单元测试和集成测试
- 支持自定义参数和默认参数测试

## API端点

- URL: `http://facai.hkpccfnewozt.xyz/tfghb/v1/api/balance`
- 方法: POST
- Content-Type: application/json

## 请求参数

```json
{
  "MemberAccount": "fcstwleon2025082727939968",
  "Currency": "VND",
  "GameID": 22020,
  "Ts": 1659405665545
}
```

## 运行测试

### 运行单元测试（使用MockWebServer）

```bash
cd datasource-callback
./gradlew test
```

### 运行集成测试（需要网络连接）

集成测试默认被禁用，如需运行实际API测试，请：

1. 在 `BalanceApiIntegrationTest.java` 中移除 `@Disabled` 注解
2. 运行测试：

```bash
./gradlew test --tests BalanceApiIntegrationTest
```

## 测试用例说明

### 单元测试 (`BalanceApiClientTest`)

1. **成功响应测试** - 验证API调用在正常情况下的可行性
2. **自定义参数测试** - 测试使用不同参数调用API
3. **错误响应处理** - 验证错误响应的处理机制
4. **超时处理** - 测试网络超时情况（占位符）
5. **JSON格式验证** - 验证请求和响应的JSON格式
6. **请求头验证** - 验证HTTP请求头设置

### 集成测试 (`BalanceApiIntegrationTest`)

1. **实际API端点测试** - 测试真实API端点的可访问性
2. **不同参数测试** - 使用不同参数组合测试API
3. **响应时间测试** - 验证API响应时间是否在可接受范围内

## 依赖

- OkHttp 4.12.0 - HTTP客户端
- Jackson 2.15.2 - JSON处理
- JUnit 5.9.3 - 测试框架
- Mockito 5.4.0 - Mock框架
- MockWebServer 4.12.0 - HTTP服务器Mock

## 使用示例

```java
// 创建客户端
BalanceApiClient client = new BalanceApiClient();

// 使用默认参数调用
String response = client.getBalanceWithDefaultParams();

// 使用自定义参数调用
String response = client.getBalance("user123", "USD", 12345, System.currentTimeMillis());
```