export function requireSupport(req, res, next) {
  const expected = process.env.SUPPORT_TOKEN || "";
  const provided = req.headers["x-support-token"];
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: "unauthorized_support" });
  }
  next();
}
