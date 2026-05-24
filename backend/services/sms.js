const Dysmsapi = require('@alicloud/dysmsapi20170525');
const { Config } = require('@alicloud/openapi-core').$OpenApiUtil;

const AK = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
const SK = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
const SIGN = process.env.ALIYUN_SMS_SIGN_NAME;
const TEMPLATE = process.env.ALIYUN_SMS_TEMPLATE_CODE;

let client = null;
function getClient() {
  if (!client && AK && SK) {
    client = new Dysmsapi.default(new Config({ accessKeyId: AK, accessKeySecret: SK, endpoint: 'dysmsapi.aliyuncs.com' }));
  }
  return client;
}

function isConfigured() {
  return !!(AK && SK && SIGN && TEMPLATE);
}

async function sendSms(phone, templateParam) {
  if (!isConfigured()) return { success: false, error: 'SMS not configured' };
  try {
    const c = getClient();
    const req = new Dysmsapi.SendSmsRequest({
      phoneNumbers: phone,
      signName: SIGN,
      templateCode: TEMPLATE,
      templateParam: JSON.stringify(templateParam),
    });
    const resp = await c.sendSms(req);
    const body = resp.body;
    if (body.code === 'OK') return { success: true, bizId: body.bizId };
    return { success: false, error: body.message || body.code };
  } catch (e) {
    return { success: false, error: e.message || 'Unknown SMS error' };
  }
}

module.exports = { sendSms, isConfigured };
