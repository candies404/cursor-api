const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { stringToHex, chunkToUtf8String, getRandomIDPro } = require('./utils.js');
const app = express();

// token 黑名单管理，使用 Map 存储 token 及其过期时间
const invalidTokens = new Map();

// 在文件顶部添加一个计数器来追踪每个 token 的使用次数
const tokenUsageCount = new Map();

// 添加 Map 用于存储 token 对应的 checksum
const tokenChecksumMap = new Map();

// 添加支持的模型列表
const SUPPORTED_MODELS = [
  {
    id: "claude-3-5-sonnet-20241022",
    created: 1706571819,
    object: "model",
    owned_by: "anthropic"
  },
  {
    id: "claude-3-opus",
    created: 1706571819,
    object: "model",
    owned_by: "anthropic"
  },
  {
    id: "claude-3-5-haiku",
    created: 1706571819,
    object: "model",
    owned_by: "anthropic"
  },
  {
    id: "claude-3-5-sonnet",
    created: 1706571819,
    object: "model",
    owned_by: "anthropic"
  },
  {
    id: "cursor-small",
    created: 1706571819,
    object: "model",
    owned_by: "cursor"
  },
  {
    id: "gemini-exp-1206",
    created: 1706571819,
    object: "model",
    owned_by: "google"
  },
  {
    id: "gemini-2.0-flash-exp",
    created: 1706571819,
    object: "model",
    owned_by: "google"
  },
  {
    id: "gemini-2.0-flash-thinking-exp",
    created: 1706571819,
    object: "model",
    owned_by: "google"
  },
  {
    id: "gpt-3.5-turbo",
    created: 1706571819,
    object: "model",
    owned_by: "openai"
  },
  {
    id: "gpt-4",
    created: 1706571819,
    object: "model",
    owned_by: "openai"
  },
  {
    id: "gpt-4-turbo-2024-04-09",
    created: 1706571819,
    object: "model",
    owned_by: "openai"
  },
  {
    id: "gpt-4o",
    created: 1706571819,
    object: "model",
    owned_by: "openai"
  },
  {
    id: "gpt-4o-mini",
    created: 1706571819,
    object: "model",
    owned_by: "openai"
  },
  {
    id: "o1-mini",
    created: 1706571819,
    object: "model",
    owned_by: "openai"
  },
  {
    id: "o1-preview",
    created: 1706571819,
    object: "model",
    owned_by: "openai"
  }
];

// 在文件顶部添加
const startTime = new Date();
const version = '1.0.0';

/**
 * 获取或生成 checksum
 * @param {string} token - 认证 token
 * @param {Object} req - 请求对象
 * @returns {string} checksum
 */
function getOrCreateChecksum(token, req) {
  const cached = tokenChecksumMap.get(token);
  
  // 如果已有缓存直接返回
  if (cached) {
    return cached.checksum;
  }
  
  // 如果没有缓存，按优先级获取或生成新的 checksum
  const checksum = req.headers['x-cursor-checksum'] ??
                  process.env['x-cursor-checksum'] ??
                  `zo${getRandomIDPro({ dictType: 'max', size: 6 })}${
                    getRandomIDPro({ dictType: 'max', size: 64 })
                  }/${
                    getRandomIDPro({ dictType: 'max', size: 64 })
                  }`;
                  
  // 存入缓存
  tokenChecksumMap.set(token, {
    checksum,
    timestamp: Date.now()
  });
  
  // 打印生成信息
  const maskedToken = `${token.slice(0, 10)}...${token.slice(-10)}`;
  console.log(`\n=== 新生成 Checksum ===`);
  console.log(`Token: ${maskedToken}`);
  console.log(`Checksum: ${checksum}`);
  console.log(`生成时间: ${new Date().toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})\n`);
  
  return checksum;
}

/**
 * 检查 token 是否有效
 * @param {string} token - 需要检查的 token
 * @returns {boolean} - token 是否有效
 */
function isTokenValid(token) {
  if (invalidTokens.has(token)) {
    const expireTime = invalidTokens.get(token);
    if (Date.now() < expireTime) {
      return false; // token 在黑名单中且未过期
    }
    invalidTokens.delete(token); // token 已过期，从黑名单中移除
  }
  return true;
}

/**
 * 将 token 加入黑名单
 * @param {string} token - 需要加入黑名单的 token
 */
function markTokenAsInvalid(token) {
  const expireTime = Date.now() + 24 * 60 * 60 * 1000; // 24小时后过期
  invalidTokens.set(token, expireTime);
  // 只显示 token 后 10 位，保护隐私
  const maskedToken = `...${token.slice(-10)}`;
  console.log(`Token ${maskedToken} 已被加入黑名单`);
  console.log(`禁用时间: ${new Date(expireTime).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
  
  // 当 token 被加入黑名单时，同时删除其对应的 checksum
  // tokenChecksumMap.delete(token);
}

// 中间件配置
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 修改根路由
app.get('/', (req, res) => {
  const uptime = Math.floor((new Date() - startTime) / 1000); // 运行时间(秒)
  
  res.json({
    status: 'healthy',
    version,
    uptime,
    stats: {
      started: startTime.toISOString(),
      memory: `${(process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)} MB`
    },
    models: SUPPORTED_MODELS.map(model => model.id),
    endpoints: [
      '/v1/chat/completions',
      '/v1/models'
    ]
  });
});

// 添加新的路由处理模型列表请求
app.get('/v1/models', (req, res) => {
  res.json({
    object: "list",
    data: SUPPORTED_MODELS
  });
});

app.post('/v1/chat/completions', async (req, res) => {
  // o1开头的模型，不支持流式输出
  if (req.body.model.startsWith('o1-') && req.body.stream) {
    return res.status(400).json({
      error: 'Model not supported stream',
    });
  }

  try {
    const { model, messages, stream = false } = req.body;
    let authToken = req.headers.authorization?.replace('Bearer ', '');
    
    // 验证 token 是否存在
    if (!authToken) {
      return res.status(401).json({
        error: 'Authorization token is required'
      });
    }

    // 处理 token 列表，支持多个 token，格式为：token1,token2,token3
    const originalTokens = authToken.split(',').map(key => key.trim());
    const processedTokens = originalTokens.map(token => {
      // 处理 URL 编码的分隔符 %3A%3A
      if (token.includes('%3A%3A')) {
        const [userId, actualToken] = token.split('%3A%3A');
        return { original: token, processed: actualToken || '' };
      }
      // 处理普通分隔符 ::
      if (token.includes('::')) {
        const [userId, actualToken] = token.split('::');
        return { original: token, processed: actualToken || '' };
      }
      return { original: token, processed: token };
    });

    // 过滤出有效的 token（非空且不在黑名单中）
    let validTokens = processedTokens.filter(({ processed }) => 
      processed && isTokenValid(processed)
    );

    // 如果没有有效的 token，返回错误
    if (validTokens.length === 0) {
      console.log('=============== Token验证失败请求结束 ===============\n');
      return res.status(401).json({
        error: {
          code: "invalid_token",
          message: "No valid authorization tokens available",
          type: "authentication_error",
          param: null
        }
      });
    }

    /**
     * 发起请求的函数，支持自动重试
     */
    async function makeRequest() {
      let selectedToken;
      
      if (validTokens.length === 1) {
        // 只有一个 token 时直接使用
        selectedToken = validTokens[0];
      } else {
        // 多个 token 时才进行排序和选择
        validTokens.sort((a, b) => 
          (tokenUsageCount.get(a.processed) || 0) - (tokenUsageCount.get(b.processed) || 0)
        );
        
        const minUsageCount = tokenUsageCount.get(validTokens[0].processed) || 0;
        const leastUsedTokens = validTokens.filter(token => 
          (tokenUsageCount.get(token.processed) || 0) === minUsageCount
        );
        selectedToken = leastUsedTokens[Math.floor(Math.random() * leastUsedTokens.length)];
      }
      
      authToken = selectedToken.processed;
      const currentUsageCount = tokenUsageCount.get(authToken) || 0;
      // 分割线
      console.log('\n=============== 请求开始 ===============\n');
      
      // 打印所有可用 token 的使用情况和对应的 checksum
      console.log('=== Token 使用情况与 Checksum ===');
      validTokens.forEach(token => {
        const count = tokenUsageCount.get(token.processed) || 0;
        const maskedToken = `${token.processed.slice(0, 10)}...${token.processed.slice(-10)}`;
        const checksumInfo = tokenChecksumMap.get(token.processed);
        const checksum = checksumInfo ? checksumInfo.checksum : '未生成';
        console.log(`Token ${maskedToken}:`);
        console.log(`  使用次数: ${count}次`);
        console.log(`  Checksum: ${checksum}`);
        // if (checksumInfo) {
        //   console.log(`  生成时间: ${new Date(checksumInfo.timestamp).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
        // }
        console.log(''); // 空行分隔
      });
      
      // 打印当前选中的 token 信息
      console.log('=== 当前请求信息 ===');
      const selectedMaskedToken = `${authToken.slice(0, 10)}...${authToken.slice(-10)}`;
      console.log(`正在使用 Token: ${selectedMaskedToken}`);
      console.log(`当前可用 Token 数量: ${validTokens.length}`);
      
      // 获取或生成 checksum
      const checksum = getOrCreateChecksum(authToken, req);
      
      // 打印 checksum 来源
      console.log('=== Checksum 信息 ===');
      if (req.headers['x-cursor-checksum']) {
        console.log('来源: 请求头');
        // console.log(`值: ${checksum}`);
      } else if (process.env['x-cursor-checksum']) {
        console.log('来源: 环境变量');
        // console.log(`值: ${checksum}`);
      } else if (tokenChecksumMap.get(authToken)) {
        console.log('来源: Token缓存');
        // console.log(`值: ${checksum}`);
        // console.log(`上次生成时间: ${new Date(tokenChecksumMap.get(authToken).timestamp).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
      } else {
        console.log('来源: 新生成');
        // console.log(`值: ${checksum}`);
      }
      
      // 更新使用计数
      tokenUsageCount.set(authToken, currentUsageCount + 1);
      
      // 将消息转换为十六进制格式
      const hexData = await stringToHex(messages, model);

      // 发起请求
      const response = await fetch('https://api2.cursor.sh/aiserver.v1.AiService/StreamChat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/connect+proto',
          authorization: `Bearer ${authToken}`,
          'connect-accept-encoding': 'gzip,br',
          'connect-protocol-version': '1',
          'user-agent': 'connect-es/1.4.0',
          'x-amzn-trace-id': `Root=${uuidv4()}`,
          'x-cursor-checksum': checksum,
          'x-cursor-client-version': '0.42.3',
          'x-cursor-timezone': 'Asia/Shanghai',
          'x-ghost-mode': 'false',
          'x-request-id': uuidv4(),
          Host: 'api2.cursor.sh',
        },
        body: hexData,
      });

            /**
       * 处理错误响应的通用函数
       * @param {Object} jsonResponse - 错误响应对象
       * @returns {boolean} - 是否需要重试
       */
      const handleErrorResponse = (jsonResponse) => {
        // 确保错误信息正确显示
        const errorMessage = typeof jsonResponse.error === 'object' 
          ? JSON.stringify(jsonResponse.error) 
          : jsonResponse.error;
        
        console.log(`Token ${selectedMaskedToken} 请求失败: ${errorMessage}`);
        markTokenAsInvalid(authToken); // 将当前 token 加入黑名单
        validTokens = validTokens.filter(t => t.processed !== authToken); // 从有效 token 列表中移除
        
        if (validTokens.length > 0) {
          console.log(`准备使用其他 Token 重试，剩余可用 Token 数量: ${validTokens.length}`);
          return true; // 还有其他 token 可用，需要重试
        }
        console.log('没有可用的 Token，请求终止');
        return false; // 没有更多 token 可用
      };

      // 处理流式响应
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const responseId = `chatcmpl-${uuidv4()}`;
        let hasError = false;

        // 逐块处理响应数据
        for await (const chunk of response.body) {
          const text = await chunkToUtf8String(chunk);
          
          try {
            // 尝试解析 JSON，检查是否是错误响应
            const jsonResponse = JSON.parse(text);
              if (jsonResponse.error) {
              if (handleErrorResponse(jsonResponse)) {
                return makeRequest(); // 重试请求
              }
              hasError = true;
              res.write(`data: ${text}\n\n`); // 返回原始错误信息
              console.log('=============== 错误请求结束 ===============\n');
              return res.end();
            }
          } catch (e) {
            // 不是 JSON 格式，说明是正常的响应数据
            if (text.length > 0) {
              res.write(
                `data: ${JSON.stringify({
                  id: responseId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [
                    {
                      index: 0,
                       delta: {
                        content: text,
                      },
                    },
                  ],
                })}\n\n`,
              );
            }
          }
        }

        // 流式响应结束
        if (!hasError) {
          res.write('data: [DONE]\n\n');
        }
        console.log('=============== 流式请求结束 ===============\n');
        return res.end();
      } else {
        // 处理非流式响应
        let text = '';
        let hasError = false;

        // 逐块处理响应数据
        for await (const chunk of response.body) {
          const chunkText = await chunkToUtf8String(chunk);
          try {
            // 尝试解析 JSON，检查是否是错误响应
            const jsonResponse = JSON.parse(chunkText);
            if (jsonResponse.error) {
              if (handleErrorResponse(jsonResponse)) {
                return makeRequest(); // 重试请求
              }
              // 将错误信息包装成标准格式
              return res.json({
                id: `chatcmpl-${uuidv4()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: JSON.stringify(jsonResponse),
                    },
                    finish_reason: 'stop',
                  },
                ],
                usage: {
                  prompt_tokens: 0,
                  completion_tokens: 0,
                  total_tokens: 0,
                },
              });
            }
          } catch (e) {
            // 不是 JSON 格式，说明是正常的响应数据
            text += chunkText;
          }
        }

        if (!hasError) {
          // 清理响应文本
          text = text.replace(/^.*<\|END_USER\|>/s, '');
          text = text.replace(/^\n[a-zA-Z]?/, '').trim();
          
          // 输出最终处理后的文本
          // console.log(text);
          
          // 返回标准格式的响应
          console.log('=============== 请求结束 ===============\n');
          return res.json({
            id: `chatcmpl-${uuidv4()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: text,
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
            },
          });
        }
      }
    }

    // 开始请求
    return makeRequest();

  } catch (error) {
    // 处理未预期的错误
    console.error('Error:', error);
    if (!res.headersSent) {
      if (req.body.stream) {
        res.write(`data: ${JSON.stringify({ error: 'Internal server error' })}\n\n`);
        console.log('=============== 服务器错误请求结束 ===============\n');
        return res.end();
      } else {
        console.log('=============== 服务器错误请求结束 ===============\n');
        return res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
