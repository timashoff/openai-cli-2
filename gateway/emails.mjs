// Email bodies for the gateway. Plain, text-first. Every code email doubles as
// a gateway-address reminder: its footer carries the public URL, so any code
// email in your inbox also tells you where the gateway is.

const OTP_TTL_MINUTES = 10

const textFooter = (gatewayUrl) =>
  gatewayUrl ? `\n\nGateway: ${gatewayUrl}\nTo log in on a device: ai login ${gatewayUrl}` : ''

const htmlFooter = (gatewayUrl) =>
  gatewayUrl
    ? `<hr><p style="color:#888">Gateway: <strong>${gatewayUrl}</strong><br>To log in on a device: <code>ai login ${gatewayUrl}</code></p>`
    : ''

export const renderOtpEmail = (code, gatewayUrl) => ({
  subject: `openai-cli login code: ${code}`,
  text:
    `Your one-time login code is ${code}.\n`
    + `It expires in ${OTP_TTL_MINUTES} minutes.\n`
    + `If you did not try to log in, ignore this email.${textFooter(gatewayUrl)}`,
  html:
    `<p>Your one-time login code is <strong style="font-size:20px">${code}</strong>.</p>`
    + `<p>It expires in ${OTP_TTL_MINUTES} minutes. If you did not try to log in, ignore this email.</p>`
    + htmlFooter(gatewayUrl),
})

export const renderResetEmail = (code, gatewayUrl) => ({
  subject: `openai-cli password reset code: ${code}`,
  text:
    `Your password reset code is ${code}.\n`
    + `It expires in ${OTP_TTL_MINUTES} minutes.\n`
    + `If you did not request a password reset, ignore this email — your password stays unchanged.${textFooter(gatewayUrl)}`,
  html:
    `<p>Your password reset code is <strong style="font-size:20px">${code}</strong>.</p>`
    + `<p>It expires in ${OTP_TTL_MINUTES} minutes. If you did not request a password reset, ignore this email — your password stays unchanged.</p>`
    + htmlFooter(gatewayUrl),
})
