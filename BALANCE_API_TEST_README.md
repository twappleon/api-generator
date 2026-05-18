# 余额API测试用例

本测试用例用于验证余额查询API的调用可行性，基于提供的OkHttp代码实现。

## 项目结构

```
workspace/
├── src/site/forgus/plugins/apigenerator/
│   └── datasource/
│       └── BalanceApiCallback.java          # 余额API回调处理器
├── test/site/forgus/plugins/apigenerator/
│   └── datasource/
│       ├── BalanceApiCallbackTest.java      # JUnit测试用例
│       └── TestRunner.java                  # 简单测试运行器
├── pom.xml                                  # Maven配置文件
├── compile-and-test.sh                      # 编译和测试脚本
└── BALANCE_API_TEST_README.md              # 本说明文件
```

## API详情

- **URL**: `http://facai.hkpccfnewozt.xyz/tfghb/v1/api/balance`
- **方法**: POST
- **Content-Type**: application/json

### 请求参数
```json
{
  "MemberAccount": "fcstwleon2025082727939968",
  "Currency": "VND",
  "GameID": 22020,
  "Ts": 1659405665545
}
```

## 运行测试的方式

### 方式1: 使用Maven (推荐)

1. **编译项目**:
   ```bash
   mvn clean compile test-compile
   ```

2. **运行简单测试器**:
   ```bash
   mvn exec:java -Dexec.mainClass="site.forgus.plugins.apigenerator.datasource.TestRunner"
   ```

3. **运行JUnit测试**:
   ```bash
   mvn test
   ```

### 方式2: 使用提供的脚本

1. **运行编译和测试脚本**:
   ```bash
   ./compile-and-test.sh
   ```

   这个脚本会：
   - 自动下载所需的JAR依赖
   - 编译源代码和测试代码
   - 运行TestRunner进行基本测试

### 方式3: 手动编译和运行

1. **下载依赖**:
   - okhttp-4.12.0.jar
   - okio-3.6.0.jar
   - gson-2.10.1.jar
   - junit-4.13.2.jar (可选，用于JUnit测试)

2. **编译**:
   ```bash
   javac -cp "lib/*" -d build/classes src/site/forgus/plugins/apigenerator/datasource/*.java
   javac -cp "lib/*:build/classes" -d build/test-classes test/site/forgus/plugins/apigenerator/datasource/*.java
   ```

3. **运行测试**:
   ```bash
   java -cp "lib/*:build/classes:build/test-classes" site.forgus.plugins.apigenerator.datasource.TestRunner
   ```

## 测试内容

### BalanceApiCallback.java
包含以下功能：
- `getBalanceSync()` - 同步API调用
- `getBalanceAsync()` - 异步API调用  
- `BalanceResponse` - 响应数据封装类
- 错误处理和资源管理

### BalanceApiCallbackTest.java (JUnit测试)
包含以下测试用例：
- `testGetBalanceSync()` - 测试同步调用
- `testGetBalanceAsync()` - 测试异步调用
- `testInvalidParameters()` - 测试无效参数处理
- `testApiConnectivity()` - 测试API连通性
- `testPerformance()` - 性能测试（5次连续调用）
- `testResponseParsing()` - 响应解析测试

### TestRunner.java (简单测试器)
不依赖JUnit框架，包含：
- 同步调用测试
- 异步调用测试
- 连通性测试（3次调用）
- 详细的控制台输出

## 测试结果说明

### 成功情况
- 显示API响应时间
- 打印完整的响应内容
- 验证响应数据结构

### 失败情况
测试可能因以下原因失败：
- 网络连接问题
- API服务器不可用
- 请求参数无效
- 超时

### 注意事项

1. **网络要求**: 需要能够访问 `facai.hkpccfnewozt.xyz` 域名
2. **时间戳**: 建议使用当前时间戳，避免使用过期的固定时间戳
3. **频率限制**: 测试中包含适当的延迟，避免过于频繁的请求
4. **错误处理**: 所有测试都包含适当的异常处理

## 扩展和定制

### 修改测试参数
在测试类中修改以下常量：
```java
private static final String TEST_MEMBER_ACCOUNT = "your_account";
private static final String TEST_CURRENCY = "your_currency";
private static final int TEST_GAME_ID = your_game_id;
```

### 添加新的测试用例
可以在 `BalanceApiCallbackTest.java` 中添加新的 `@Test` 方法，或在 `TestRunner.java` 中添加新的测试方法。

### 修改API端点
在 `BalanceApiCallback.java` 中修改 `API_URL` 常量。

## 依赖说明

- **OkHttp**: HTTP客户端库，用于发起API请求
- **Gson**: JSON解析库，用于处理请求和响应数据
- **JUnit**: 单元测试框架（可选）
- **Apache HttpClient**: 项目现有依赖

## 故障排除

1. **编译错误**: 确保所有依赖JAR文件都已正确下载
2. **网络错误**: 检查网络连接和防火墙设置
3. **超时错误**: 可能需要增加超时时间或检查API服务状态
4. **权限错误**: 确保脚本文件有执行权限 (`chmod +x compile-and-test.sh`)

## 联系和支持

如果遇到问题或需要帮助，请检查：
- 网络连接状态
- API端点是否正确
- 请求参数是否有效
- 依赖库是否正确安装