import re

FORBIDDEN_PASSWORDS = {
    "admin",
    "admin123",
    "password",
    "password123",
    "123456",
    "12345678",
    "ctem123",
}


def is_demo_credential(username: str, password: str) -> bool:
    return username.strip().lower() == "admin" and password == "admin123"


def validate_password_strength(password: str) -> str:
    if len(password) < 12:
        raise ValueError("密码至少 12 位")
    if password.lower() in FORBIDDEN_PASSWORDS:
        raise ValueError("不能使用默认密码或常见弱密码")
    if not re.search(r"[A-Z]", password):
        raise ValueError("密码必须包含大写字母")
    if not re.search(r"[a-z]", password):
        raise ValueError("密码必须包含小写字母")
    if not re.search(r"\d", password):
        raise ValueError("密码必须包含数字")
    if not re.search(r"[^A-Za-z0-9]", password):
        raise ValueError("密码必须包含特殊字符")
    return password
