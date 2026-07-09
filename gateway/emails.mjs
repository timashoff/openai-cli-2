// Email bodies for the gateway. Plain, text-first. The one-time login code doubles
// as a gateway-address reminder: its footer carries the public URL, so every login
// email in your inbox also tells you where the gateway is.

const OTP_TTL_MINUTES = 10

export const renderOtpEmail = (code, gatewayUrl) => {
  const footer = gatewayUrl ? `\n\nGateway: ${gatewayUrl}\nTo log in on a device: ai login ${gatewayUrl}` : ''
  const htmlFooter = gatewayUrl
    ? `<hr><p style="color:#888">Gateway: <strong>${gatewayUrl}</strong><br>To log in on a device: <code>ai login ${gatewayUrl}</code></p>`
    : ''
  return {
    subject: `openai-cli login code: ${code}`,
    text:
      `Your one-time login code is ${code}.\n`
      + `It expires in ${OTP_TTL_MINUTES} minutes.\n`
      + `If you did not try to log in, ignore this email.${footer}`,
    html:
      `<p>Your one-time login code is <strong style="font-size:20px">${code}</strong>.</p>`
      + `<p>It expires in ${OTP_TTL_MINUTES} minutes. If you did not try to log in, ignore this email.</p>`
      + htmlFooter,
  }
}
