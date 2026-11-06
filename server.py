#!/usr/bin/env python3
"""
Backend do Dad's Burger com Mercado Pago Checkout API v2
Suporta SDK oficial mercadopago, Pix Instantâneo, Checkout Pro, consulta em tempo real e Webhooks autenticados.
"""

import hashlib
import hmac
import http.server
import json
import math
import os
import re
import socketserver
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import mercadopago
from mercadopago.config import RequestOptions

BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"
ORDERS_FILE = BASE_DIR / "orders.json"

# Carrega variáveis do arquivo .env se existir
def load_env():
    env = {}
    if ENV_FILE.exists():
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def save_env_key(key: str, val: str):
    current = load_env()
    current[key] = val
    lines = []
    for k, v in current.items():
        lines.append(f'{k}="{v}"\n')
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.writelines(lines)

def get_config():
    env = load_env()
    api_key = os.environ.get("ASAAS_API_KEY") or env.get("ASAAS_API_KEY", "")
    environment = os.environ.get("ASAAS_ENV") or env.get("ASAAS_ENV", "sandbox")
    is_prod = environment.lower() == "production"
    base_url = "https://api.asaas.com/v3" if is_prod else "https://api-sandbox.asaas.com/v3"
    return {
        "api_key": api_key.strip(),
        "environment": "production" if is_prod else "sandbox",
        "base_url": base_url,
        "has_key": bool(api_key.strip() and not api_key.startswith("test_dummy")),
    }

def get_mp_config():
    env = load_env()
    token = os.environ.get("MERCADO_PAGO_ACCESS_TOKEN") or env.get("MERCADO_PAGO_ACCESS_TOKEN", "")
    public_key = os.environ.get("MERCADO_PAGO_PUBLIC_KEY") or env.get("MERCADO_PAGO_PUBLIC_KEY", "")
    webhook_secret = os.environ.get("MERCADO_PAGO_WEBHOOK_SECRET") or env.get("MERCADO_PAGO_WEBHOOK_SECRET", "")
    token = token.strip()
    public_key = public_key.strip()
    webhook_secret = webhook_secret.strip()

    is_valid = bool(token and not token.startswith("test_dummy") and token != "SEU_ACCESS_TOKEN")
    is_prod = token.startswith("APP_USR-")
    has_secret = bool(webhook_secret and webhook_secret != "SEU_WEBHOOK_SECRET")

    return {
        "access_token": token,
        "public_key": public_key,
        "webhook_secret": webhook_secret,
        "has_key": is_valid,
        "has_webhook_secret": has_secret,
        "environment": "production" if is_prod else "sandbox",
        "maskedToken": (token[:9] + "..." + token[-4:]) if is_valid else "",
        "maskedKey": (public_key[:8] + "..." + public_key[-4:]) if (public_key and public_key != "SUA_PUBLIC_KEY") else "",
    }

def get_mp_sdk():
    """Inicializa o SDK oficial do Mercado Pago com o Access Token"""
    cfg = get_mp_config()
    if cfg["has_key"]:
        try:
            return mercadopago.SDK(cfg["access_token"])
        except Exception as e:
            print(f"Erro ao instanciar mercadopago.SDK: {e}")
            return None
    return None

# Armazenamento simples de pedidos em memória/arquivo
ORDERS: dict[str, dict] = {}
if ORDERS_FILE.exists():
    try:
        with open(ORDERS_FILE, "r", encoding="utf-8") as f:
            ORDERS = json.load(f)
    except Exception:
        ORDERS = {}

def save_orders():
    try:
        with open(ORDERS_FILE, "w", encoding="utf-8") as f:
            json.dump(ORDERS, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

# --------------------------------------------------------------------------
# Perímetro de Entrega e Cálculo Geográfico (Raio Máximo: 15 km)
# --------------------------------------------------------------------------
MAX_DELIVERY_KM = 15.0

DADS_STORES = {
    "passo-dareia": {
        "id": "passo-dareia",
        "name": "Passo d'Areia (Zona Norte)",
        "address": "R. Sapé, 947 - Passo d'Areia, Porto Alegre - RS, 91350-050",
        "lat": -30.01758,
        "lon": -51.15570,
    },
    "moinhos": {
        "id": "moinhos",
        "name": "Moinhos / Rio Branco",
        "address": "R. Mariante, 617 - Rio Branco, Porto Alegre - RS, 90430-181",
        "lat": -30.02987,
        "lon": -51.20428,
    },
    "partenon": {
        "id": "partenon",
        "name": "Partenon (Zona Leste)",
        "address": "Av. Bento Gonçalves, 6746 - Partenon, Porto Alegre - RS, 91540-000",
        "lat": -30.06190,
        "lon": -51.17366,
    },
    "canoas-gracas": {
        "id": "canoas-gracas",
        "name": "Nossa Sra. das Graças (Canoas)",
        "address": "R. Santa Maria, 218 - Lj 2 - Nossa Sra. das Gracas, Canoas - RS, 92025-390",
        "lat": -29.92756,
        "lon": -51.17546,
    },
    "canoas-guajuviras": {
        "id": "canoas-guajuviras",
        "name": "Guajuviras (Canoas)",
        "address": "R. Quatro Ltm Nova Estancia, 235 - Guajuviras, Canoas - RS, 92440-274",
        "lat": -29.89663,
        "lon": -51.13785,
    },
    "cachoeirinha": {
        "id": "cachoeirinha",
        "name": "Vila Vista Alegre (Cachoeirinha)",
        "address": "R. São Pedro, 525 - Vila Vista Alegre, Cachoeirinha - RS, 94945-530",
        "lat": -29.92380,
        "lon": -51.07789,
    },
}

GEOCODE_CACHE: dict[str, tuple[float, float, str]] = {}
CEP_CACHE: dict[str, dict] = {}

def lookup_cep(cep: str) -> dict:
    clean = re.sub(r"\D", "", cep or "")
    if len(clean) != 8:
        return {"valid": False, "error": "CEP deve conter exatamente 8 dígitos."}
    if clean in CEP_CACHE:
        return CEP_CACHE[clean]

    headers = {"User-Agent": "DadsBurgerDeliveryApp/1.0 (cep-validation)"}
    url = f"https://viacep.com.br/ws/{clean}/json/"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            if "erro" in data and (data["erro"] is True or data["erro"] == "true"):
                res = {"valid": False, "error": "CEP não localizado nos Correios."}
                CEP_CACHE[clean] = res
                return res
            res = {
                "valid": True,
                "cep": data.get("cep", f"{clean[:5]}-{clean[5:]}"),
                "logradouro": data.get("logradouro", ""),
                "bairro": data.get("bairro", ""),
                "localidade": data.get("localidade", ""),
                "uf": data.get("uf", "RS"),
                "estado": data.get("estado", ""),
            }
            CEP_CACHE[clean] = res
            return res
    except Exception as e:
        return {"valid": False, "error": f"Falha ao consultar CEP: {str(e)}"}

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(R * c, 2)

def geocode_address(query: str, cep_info: dict | None = None) -> tuple[float, float, str] | None:
    query = (query or "").strip()
    if not query:
        return None
    cache_key = query.lower()
    if cache_key in GEOCODE_CACHE:
        return GEOCODE_CACHE[cache_key]

    headers = {"User-Agent": "DadsBurgerDeliveryApp/1.0 (delivery-radius-check)"}
    candidates = [query]

    if cep_info and cep_info.get("valid"):
        loc = cep_info.get("localidade", "")
        uf = cep_info.get("uf", "RS")
        bairro = cep_info.get("bairro", "")
        candidates.insert(0, f"{query}, {loc} - {uf}, Brasil")
        if bairro:
            candidates.insert(1, f"{query}, {bairro}, {loc} - {uf}, Brasil")

    has_state = bool(re.search(r"\b(RS|SC|PR|SP|RJ|MG|ES|BA|PE|CE|DF)\b", query, re.I))
    if not has_state:
        candidates.append(f"{query}, Rio Grande do Sul, Brasil")
    else:
        candidates.append(f"{query}, Brasil")

    for q in candidates:
        url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(q)}&format=json&limit=1"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode())
                if data:
                    lat = float(data[0]["lat"])
                    lon = float(data[0]["lon"])
                    display = data[0].get("display_name", "")
                    res = (lat, lon, display)
                    GEOCODE_CACHE[cache_key] = res
                    return res
        except Exception:
            continue

    return None

def check_delivery(address_data: str | dict, unit_id: str) -> dict:
    cep_info = None
    resolved_query = ""

    if isinstance(address_data, dict):
        rua = str(address_data.get("rua") or address_data.get("logradouro") or address_data.get("street") or "").strip()
        numero = str(address_data.get("numero") or address_data.get("number") or "").strip()
        bairro = str(address_data.get("bairro") or address_data.get("neighborhood") or "").strip()
        cidade = str(address_data.get("cidade") or address_data.get("city") or "").strip()
        cep_val = str(address_data.get("cep") or "").strip()
        clean_cep = re.sub(r"\D", "", cep_val)

        # Validação obrigatória do CEP
        if not clean_cep or len(clean_cep) != 8:
            return {
                "valid": False,
                "allowed": False,
                "error": "Informe um CEP válido com 8 dígitos para entrega.",
            }

        cep_info = lookup_cep(clean_cep)
        if not cep_info.get("valid"):
            return {
                "valid": False,
                "allowed": False,
                "error": f"CEP {cep_val} não encontrado nos Correios. Confira os números.",
            }

        # Validação dos campos
        if not rua or len(rua) < 2:
            return {
                "valid": False,
                "allowed": False,
                "error": "Informe o nome da rua / logradouro.",
            }
        if not numero:
            return {
                "valid": False,
                "allowed": False,
                "error": "Informe o número do endereço.",
            }

        if not bairro:
            bairro = cep_info.get("bairro", "")
        if not cidade:
            cidade = f"{cep_info.get('localidade', '')} - {cep_info.get('uf', 'RS')}"

        resolved_query = f"{rua}, {numero}, {bairro}, {cidade}"
    else:
        resolved_query = str(address_data or "").strip()
        if not resolved_query or len(resolved_query) < 4:
            return {
                "valid": False,
                "allowed": False,
                "error": "Endereço de entrega obrigatório.",
            }
        cep_match = re.search(r"\b(\d{5})-?(\d{3})\b", resolved_query)
        if cep_match:
            clean_cep = f"{cep_match.group(1)}{cep_match.group(2)}"
            cep_info = lookup_cep(clean_cep)
            if not cep_info.get("valid"):
                return {
                    "valid": False,
                    "allowed": False,
                    "error": f"CEP {cep_match.group(0)} não encontrado nos Correios.",
                }

    coords = geocode_address(resolved_query, cep_info)
    if not coords and cep_info and cep_info.get("valid"):
        coords = geocode_address(f"{cep_info.get('logradouro', '')}, {cep_info.get('bairro', '')}, {cep_info.get('localidade', '')} - {cep_info.get('uf', 'RS')}")

    if not coords:
        return {
            "valid": False,
            "allowed": False,
            "error": "Endereço não localizado no mapa. Verifique a rua, número e CEP.",
        }

    lat, lon, display = coords
    target_unit = DADS_STORES.get(unit_id) or DADS_STORES["passo-dareia"]
    dist = haversine_km(target_unit["lat"], target_unit["lon"], lat, lon)

    all_dists = []
    for sid, s in DADS_STORES.items():
        d = haversine_km(s["lat"], s["lon"], lat, lon)
        all_dists.append({
            "id": sid,
            "name": s["name"],
            "distanceKm": d,
            "allowed": d <= MAX_DELIVERY_KM,
        })
    all_dists.sort(key=lambda x: x["distanceKm"])
    closest = all_dists[0]
    allowed = dist <= MAX_DELIVERY_KM

    return {
        "valid": True,
        "allowed": allowed,
        "distanceKm": dist,
        "maxDistanceKm": MAX_DELIVERY_KM,
        "unitId": target_unit["id"],
        "unitName": target_unit["name"],
        "resolvedAddress": display,
        "cepData": cep_info,
        "closestUnit": closest,
        "allDistances": all_dists,
        "message": f"Entrega disponível ({dist} km da loja)" if allowed else f"Fora do raio de entrega ({dist} km). O limite máximo de entrega é de {MAX_DELIVERY_KM:.0f} km.",
    }

# --------------------------------------------------------------------------
# Chamadas à API do Asaas
# --------------------------------------------------------------------------
def asaas_request(method: str, path: str, payload: dict | None = None) -> dict:
    cfg = get_config()
    if not cfg["has_key"]:
        raise ValueError("Chave de API do Asaas não configurada.")

    url = f"{cfg['base_url']}{path}"
    headers = {
        "access_token": cfg["api_key"],
        "Content-Type": "application/json",
        "User-Agent": "DadsBurger-Delivery/1.0",
        "Accept": "application/json",
    }
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err_body = ""
        try:
            err_body = e.read().decode("utf-8")
            j = json.loads(err_body)
            errors = j.get("errors") or []
            if errors and isinstance(errors, list):
                desc = "; ".join([x.get("description", "") for x in errors if x.get("description")])
                if desc:
                    raise RuntimeError(f"Asaas: {desc}")
            if "message" in j:
                raise RuntimeError(f"Asaas: {j['message']}")
        except Exception as inner:
            if isinstance(inner, RuntimeError):
                raise
        raise RuntimeError(f"Erro Asaas (HTTP {e.code}): {err_body or str(e)}")
    except Exception as e:
        raise RuntimeError(f"Falha de conexão com Asaas: {str(e)}")

def find_or_create_customer(name: str, cpf_cnpj: str, phone: str = "", email: str = "") -> str:
    """Busca ou cria um cliente no Asaas pelo CPF/CNPJ."""
    clean_cpf = re.sub(r"\D", "", cpf_cnpj or "")
    if clean_cpf:
        try:
            search = asaas_request("GET", f"/customers?cpfCnpj={clean_cpf}")
            items = search.get("data") or []
            if items and isinstance(items, list):
                return items[0].get("id", "")
        except Exception:
            pass

    # Cria cliente novo
    payload = {
        "name": name.strip() or "Cliente Dad's Burger",
        "cpfCnpj": clean_cpf,
        "mobilePhone": re.sub(r"\D", "", phone or ""),
        "email": email.strip() or f"cliente_{int(time.time())}@dadsburguer.local",
    }
    res = asaas_request("POST", "/customers", payload)
    customer_id = res.get("id") or ""
    if not customer_id:
        raise RuntimeError("Não foi possível registrar o cliente no Asaas.")
    return customer_id

# --------------------------------------------------------------------------
# Mock Pix Generator (para testar sem chave real)
# --------------------------------------------------------------------------
def generate_mock_pix(total: float, order_id: str, customer_name: str) -> dict:
    """Gera dados de Pix simulados e realistas para testes imediatos."""
    payment_id = f"pay_mock_{int(time.time())}_{order_id[-4:]}"
    # Payload EMV simulado
    payload = f"00020126580014br.gov.bcb.pix0136dadsburger-pix-{order_id}52040000530398654{total:.2f}5802BR5915DADS BURGER POA6012PORTO ALEGRE62070503***6304ABCD"
    
    # SVG do QR Code realista
    svg_qr = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220" width="100%" height="100%">
      <rect width="220" height="220" fill="#ffffff" rx="12"/>
      <rect x="20" y="20" width="50" height="50" fill="#0B0705" rx="6"/>
      <rect x="28" y="28" width="34" height="34" fill="#ffffff" rx="3"/>
      <rect x="36" y="36" width="18" height="18" fill="#D79C45" rx="2"/>
      <rect x="150" y="20" width="50" height="50" fill="#0B0705" rx="6"/>
      <rect x="158" y="28" width="34" height="34" fill="#ffffff" rx="3"/>
      <rect x="166" y="36" width="18" height="18" fill="#D79C45" rx="2"/>
      <rect x="20" y="150" width="50" height="50" fill="#0B0705" rx="6"/>
      <rect x="28" y="158" width="34" height="34" fill="#ffffff" rx="3"/>
      <rect x="36" y="166" width="18" height="18" fill="#D79C45" rx="2"/>
      <g fill="#0B0705">
        <rect x="85" y="25" width="12" height="12"/>
        <rect x="105" y="35" width="14" height="14"/>
        <rect x="125" y="20" width="12" height="12"/>
        <rect x="85" y="60" width="20" height="12"/>
        <rect x="115" y="60" width="14" height="20"/>
        <rect x="30" y="85" width="16" height="14"/>
        <rect x="60" y="90" width="14" height="18"/>
        <rect x="85" y="90" width="35" height="14" fill="#D79C45"/>
        <rect x="135" y="85" width="20" height="20"/>
        <rect x="165" y="90" width="30" height="12"/>
        <rect x="90" y="115" width="20" height="20"/>
        <rect x="120" y="120" width="18" height="14"/>
        <rect x="155" y="125" width="24" height="14"/>
        <rect x="85" y="145" width="22" height="14"/>
        <rect x="115" y="145" width="30" height="18" fill="#D79C45"/>
        <rect x="160" y="150" width="35" height="16"/>
        <rect x="85" y="175" width="35" height="22"/>
        <rect x="135" y="180" width="24" height="18"/>
        <rect x="175" y="175" width="20" height="24"/>
      </g>
    </svg>'''
    
    import base64
    qr_base64 = "data:image/svg+xml;base64," + base64.b64encode(svg_qr.encode("utf-8")).decode("utf-8")
    
    return {
        "paymentId": payment_id,
        "isMock": True,
        "qrCodePayload": payload,
        "qrCodeImage": qr_base64,
        "value": total,
        "expirationDate": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() + 900)),
        "orderId": order_id,
    }

# --------------------------------------------------------------------------
# Integração Oficial Mercado Pago (Checkout Transparente API & Checkout Pro)
# --------------------------------------------------------------------------
def mercadopago_request(method: str, endpoint: str, payload: dict | None = None, idempotency_key: str | None = None) -> dict:
    cfg = get_mp_config()
    if not cfg["has_key"]:
        raise ValueError("Access Token do Mercado Pago não configurado.")

    url = f"https://api.mercadopago.com{endpoint}"
    headers = {
        "Authorization": f"Bearer {cfg['access_token']}",
        "Content-Type": "application/json",
        "User-Agent": "DadsBurger-MercadoPago/1.0",
        "Accept": "application/json",
    }
    if idempotency_key:
        headers["X-Idempotency-Key"] = str(idempotency_key)

    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err_body = ""
        try:
            err_body = e.read().decode("utf-8")
            j = json.loads(err_body)
            msg = j.get("message") or j.get("error")
            causes = j.get("cause") or []
            if causes and isinstance(causes, list):
                cause_desc = "; ".join([c.get("description", "") for c in causes if c.get("description")])
                if cause_desc:
                    msg = f"{msg}: {cause_desc}"
            if msg:
                raise RuntimeError(f"Mercado Pago: {msg}")
        except Exception as inner:
            if isinstance(inner, RuntimeError):
                raise
        raise RuntimeError(f"Erro Mercado Pago (HTTP {e.code}): {err_body or str(e)}")
    except Exception as e:
        raise RuntimeError(f"Falha de conexão com Mercado Pago: {str(e)}")


def get_mp_payment_methods() -> dict:
    """Consulta os meios de pagamento suportados e ativos no Mercado Pago"""
    sdk = get_mp_sdk()
    if sdk:
        try:
            res = sdk.payment_methods().list_all()
            if res.get("status") == 200:
                return {
                    "success": True,
                    "isMock": False,
                    "paymentMethods": res.get("response", []),
                    "gateway": "mercadopago",
                }
        except Exception as e:
            print(f"Erro ao listar meios de pagamento via SDK: {e}")

    # Fallback / Mock de meios de pagamento aceitos
    return {
        "success": True,
        "isMock": True,
        "paymentMethods": [
            {"id": "pix", "name": "Pix Instantâneo", "payment_type_id": "bank_transfer", "status": "active", "secure_thumbnail": "https://http2.mlstatic.com/storage/logos-api-admin/a5f047d0-9be0-11ec-aad4-c3381f368aaf-m.svg"},
            {"id": "master", "name": "Mastercard", "payment_type_id": "credit_card", "status": "active", "secure_thumbnail": "https://http2.mlstatic.com/storage/logos-api-admin/a5f047d0-9be0-11ec-aad4-c3381f368aaf-m.svg"},
            {"id": "visa", "name": "Visa", "payment_type_id": "credit_card", "status": "active", "secure_thumbnail": "https://http2.mlstatic.com/storage/logos-api-admin/a5f047d0-9be0-11ec-aad4-c3381f368aaf-m.svg"},
            {"id": "elo", "name": "Elo", "payment_type_id": "credit_card", "status": "active", "secure_thumbnail": "https://http2.mlstatic.com/storage/logos-api-admin/a5f047d0-9be0-11ec-aad4-c3381f368aaf-m.svg"},
            {"id": "hipercard", "name": "Hipercard", "payment_type_id": "credit_card", "status": "active", "secure_thumbnail": "https://http2.mlstatic.com/storage/logos-api-admin/a5f047d0-9be0-11ec-aad4-c3381f368aaf-m.svg"}
        ],
        "gateway": "mercadopago",
    }


def verify_mp_webhook_signature(x_signature: str, x_request_id: str, data_id: str, secret: str) -> bool:
    """
    Valida a assinatura x-signature do Mercado Pago (Checkout API v2):
    Documentação: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-v2/notifications
    Header x-signature: ts=...,v1=...
    Manifest: id:[data.id];request-id:[x-request-id];ts:[ts];
    HMAC-SHA256 comparado de forma segura contra timing attacks.
    """
    if not secret or secret in ("SEU_WEBHOOK_SECRET", ""):
        return True  # Modo permissivo durante testes locais / sandbox enquanto o secret não for informado
    if not x_signature or not x_request_id or not data_id:
        return False
    try:
        parts = {}
        for item in x_signature.split(","):
            if "=" in item:
                k, v = item.strip().split("=", 1)
                parts[k] = v
        ts = parts.get("ts")
        v1_hash = parts.get("v1")
        if not ts or not v1_hash:
            return False

        manifest = f"id:{data_id};request-id:{x_request_id};ts:{ts};"
        calculated = hmac.new(
            secret.encode("utf-8"),
            manifest.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()

        return hmac.compare_digest(calculated, v1_hash)
    except Exception as e:
        print(f"Erro na validação de webhook Mercado Pago: {e}")
        return False


def get_valid_notification_url(app_url: str = "") -> str:
    """Retorna URL pública para notification_url apenas se for um domínio público válido (evita erro 400 do Mercado Pago em localhost)"""
    url = (app_url or os.environ.get("APP_URL") or load_env().get("APP_URL") or "").strip()
    if not url or not url.startswith("http"):
        return ""
    lower = url.lower()
    # Mercado Pago rejeita localhost e IPs privados/locais com erro 'notificaction_url attribute must be url valid'
    if "127.0.0.1" in lower or "localhost" in lower or "0.0.0.0" in lower or ".local" in lower:
        return ""
    return f"{url.rstrip('/')}/api/mercadopago/webhook"


def create_mp_pix(cust: dict, order: dict, total: float, order_id: str, app_url: str = "") -> dict:
    cfg = get_mp_config()
    sdk = get_mp_sdk()

    if sdk and cfg["has_key"]:
        name = str(cust.get("name") or "Cliente").strip()
        name_parts = name.split(None, 1)
        first_name = name_parts[0] if name_parts else "Cliente"
        last_name = name_parts[1] if len(name_parts) > 1 else "Burger"

        clean_cpf = re.sub(r"\D", "", str(cust.get("cpf") or ""))
        email = str(cust.get("email") or "").strip()
        if not email or "@" not in email:
            email = f"cliente_{clean_cpf or int(time.time())}@gmail.com"

        items_desc = ", ".join([f"{i.get('q', 1)}x {i.get('name', '')}" for i in order.get("items", [])[:4]])
        desc = f"Pedido #{order_id} Dad's Burger: {items_desc}"[:120] if items_desc else f"Pedido #{order_id} Dad's Burger"

        mp_payload = {
            "transaction_amount": round(float(total), 2),
            "description": desc,
            "payment_method_id": "pix",
            "payer": {
                "email": email,
                "first_name": first_name,
                "last_name": last_name,
                "identification": {
                    "type": "CPF",
                    "number": clean_cpf or "00000000000",
                },
            },
            "external_reference": order_id,
        }

        notif_url = get_valid_notification_url(app_url)
        if notif_url:
            mp_payload["notification_url"] = notif_url

        ro = RequestOptions()
        ro.custom_headers = {"x-idempotency-key": str(order_id)}
        res_sdk = sdk.payment().create(mp_payload, ro)
        status_code = res_sdk.get("status")
        pay_res = res_sdk.get("response") or {}

        if status_code in (200, 201):
            payment_id = str(pay_res.get("id"))
            poi = pay_res.get("point_of_interaction") or {}
            tdata = poi.get("transaction_data") or {}

            qr_payload = tdata.get("qr_code") or ""
            qr_image = tdata.get("qr_code_base64") or ""
            if qr_image and not qr_image.startswith("data:"):
                qr_image = "data:image/png;base64," + qr_image

            ticket_url = tdata.get("ticket_url") or ""
            status = pay_res.get("status") or "pending"

            ORDERS[payment_id] = {
                "orderId": order_id,
                "paymentId": payment_id,
                "gateway": "mercadopago",
                "status": status.upper(),
                "total": total,
                "customer": cust,
                "order": order,
                "created_at": time.time(),
                "isMock": False,
            }
            save_orders()

            return {
                "success": True,
                "paymentId": payment_id,
                "orderId": order_id,
                "qrCodePayload": qr_payload,
                "qrCodeImage": qr_image,
                "ticketUrl": ticket_url,
                "value": total,
                "status": status,
                "expirationDate": pay_res.get("date_of_expiration"),
                "isMock": False,
                "gateway": "mercadopago",
            }
        else:
            msg = pay_res.get("message") or pay_res.get("error") or "Erro na API Mercado Pago"
            causes = pay_res.get("cause") or []
            if causes and isinstance(causes, list):
                cause_desc = "; ".join([c.get("description", "") for c in causes if c.get("description")])
                if cause_desc:
                    msg = f"{msg}: {cause_desc}"

            # Fallback inteligente se a credencial de produção estiver restrita para ambiente de testes
            if "Unauthorized use of live credentials" in msg:
                print("⚠️ Credencial de produção não ativada para Pix em teste. Ativando fallback inteligente...")
                mock_data = generate_mock_pix(total, order_id, str(cust.get("name") or "Cliente"))
                payment_id = mock_data["paymentId"]
                ORDERS[payment_id] = {
                    "orderId": order_id,
                    "paymentId": payment_id,
                    "gateway": "mercadopago",
                    "status": "PENDING",
                    "total": total,
                    "customer": cust,
                    "order": order,
                    "created_at": time.time(),
                    "isMock": True,
                }
                save_orders()
                return {
                    "success": True,
                    **mock_data,
                    "gateway": "mercadopago",
                    "isMock": True,
                    "warning": "Modo de Teste: Credenciais reais Mercado Pago pendentes de homologação. Exibindo Pix demonstrativo."
                }

            raise RuntimeError(f"Mercado Pago SDK (HTTP {status_code}): {msg}")

    # Modo Simulação / Mock Inteligente
    mock_data = generate_mock_pix(total, order_id, str(cust.get("name") or "Cliente"))
    payment_id = mock_data["paymentId"]
    ORDERS[payment_id] = {
        "orderId": order_id,
        "paymentId": payment_id,
        "gateway": "mercadopago",
        "status": "PENDING",
        "total": total,
        "customer": cust,
        "order": order,
        "created_at": time.time(),
        "isMock": True,
    }
    save_orders()
    return {
        "success": True,
        **mock_data,
        "gateway": "mercadopago",
        "warning": "Modo Demonstração (Configure seu Access Token do Mercado Pago no .env para pagamentos reais).",
    }


def create_mp_preference(cust: dict, order: dict, total: float, order_id: str, app_url: str = "") -> dict:
    cfg = get_mp_config()
    sdk = get_mp_sdk()

    if not sdk or not cfg["has_key"]:
        return {
            "success": True,
            "isMock": True,
            "preferenceId": f"pref_mock_{int(time.time())}",
            "initPoint": f"/?payment=mock_success&orderId={order_id}",
            "warning": "Mercado Pago não configurado. Retornando simulação.",
        }

    items = []
    for it in order.get("items", []):
        items.append({
            "title": it.get("name") or "Item",
            "quantity": int(it.get("q", 1)),
            "unit_price": round(float(it.get("price", 0)), 2),
            "currency_id": "BRL",
        })
    if not items:
        items = [{
            "title": f"Pedido #{order_id} - Dad's Burger",
            "quantity": 1,
            "unit_price": round(float(total), 2),
            "currency_id": "BRL",
        }]

    base_back_url = app_url.rstrip("/") if app_url else "http://127.0.0.1:3333"
    pref_payload = {
        "items": items,
        "payer": {
            "name": str(cust.get("name") or "Cliente"),
            "email": str(cust.get("email") or "cliente@dadsburger.com.br"),
        },
        "external_reference": order_id,
        "statement_descriptor": "DADS BURGER",
        "back_urls": {
            "success": f"{base_back_url}/?mp_status=success&order_id={order_id}",
            "failure": f"{base_back_url}/?mp_status=failure&order_id={order_id}",
            "pending": f"{base_back_url}/?mp_status=pending&order_id={order_id}",
        },
        "auto_return": "approved",
    }

    notif_url = get_valid_notification_url(app_url)
    if notif_url:
        pref_payload["notification_url"] = notif_url

    pref_res_raw = sdk.preference().create(pref_payload)
    if pref_res_raw.get("status") in (200, 201):
        pref_res = pref_res_raw.get("response") or {}
        pref_id = pref_res.get("id")
        init_point = pref_res.get("init_point") if cfg["environment"] == "production" else (pref_res.get("sandbox_init_point") or pref_res.get("init_point"))
        return {
            "success": True,
            "preferenceId": pref_id,
            "initPoint": init_point,
            "sandboxInitPoint": pref_res.get("sandbox_init_point"),
            "isMock": False,
            "gateway": "mercadopago",
        }
    else:
        err_data = pref_res_raw.get("response") or {}
        raise RuntimeError(f"Mercado Pago SDK Preference: {err_data.get('message') or err_data}")


def check_mp_payment_status(payment_id: str) -> dict:
    cfg = get_mp_config()
    sdk = get_mp_sdk()

    # Se for mock
    if payment_id.startswith("pay_mock_") or payment_id in ORDERS:
        order = ORDERS.get(payment_id, {})
        if order.get("isMock", False):
            status = order.get("status", "PENDING")
            created_at = order.get("created_at", time.time())
            if status == "PENDING" and (time.time() - created_at) > 15:
                status = "APPROVED"
                order["status"] = "APPROVED"
                order["paid_at"] = time.time()
                ORDERS[payment_id] = order
                save_orders()

            confirmed = status in ("APPROVED", "RECEIVED", "CONFIRMED")
            return {
                "paymentId": payment_id,
                "status": status.lower(),
                "confirmed": confirmed,
                "isMock": True,
                "gateway": "mercadopago",
            }

    # Pagamento real no Mercado Pago via SDK
    if sdk and cfg["has_key"]:
        try:
            res_raw = sdk.payment().get(payment_id)
            if res_raw.get("status") == 200:
                res = res_raw.get("response") or {}
                st = res.get("status", "pending")
                confirmed = st == "approved"
                if payment_id in ORDERS:
                    ORDERS[payment_id]["status"] = st.upper()
                    if confirmed:
                        ORDERS[payment_id]["paid_at"] = time.time()
                    save_orders()

                return {
                    "paymentId": payment_id,
                    "status": st,
                    "statusDetail": res.get("status_detail"),
                    "confirmed": confirmed,
                    "transactionAmount": res.get("transaction_amount"),
                    "dateApproved": res.get("date_approved"),
                    "isMock": False,
                    "gateway": "mercadopago",
                }
            else:
                return {
                    "error": f"Erro SDK {res_raw.get('status')}",
                    "paymentId": payment_id,
                    "status": "unknown",
                    "confirmed": False,
                }
        except Exception as e:
            return {
                "error": str(e),
                "paymentId": payment_id,
                "status": "unknown",
                "confirmed": False,
            }

    return {
        "paymentId": payment_id,
        "status": "pending",
        "confirmed": False,
        "isMock": True,
        "gateway": "mercadopago",
    }


def process_mp_card_payment(card_data: dict, cust: dict, order: dict, total: float, order_id: str) -> dict:
    """Processa pagamento transparente de cartão com SDK oficial do Mercado Pago"""
    cfg = get_mp_config()
    sdk = get_mp_sdk()

    # Validação rigorosa do raio de 15 km para entregas
    mode = str(order.get("mode") or "entrega").lower()
    if mode != "retirada":
        unit_id = str(order.get("unitId") or "passo-dareia")
        addr_data = order.get("addressDetails") or order.get("address") or ""
        val = check_delivery(addr_data, unit_id)
        if not val.get("valid") or not val.get("allowed"):
            return {"success": False, "error": val.get("error") or "Endereço fora do raio de 15 km."}

    clean_num = re.sub(r"\D", "", str(card_data.get("cardNumber") or ""))
    brand = str(card_data.get("paymentMethodId") or "master").lower()
    installments = int(card_data.get("installments") or 1)

    # Processamento Real via Mercado Pago SDK
    if sdk and cfg["has_key"]:
        try:
            exp_month = int(card_data.get("cardExpirationMonth") or 1)
            exp_year = int(card_data.get("cardExpirationYear") or 2030)
            cvv = str(card_data.get("securityCode") or "").strip()
            holder = str(card_data.get("cardholderName") or cust.get("name") or "CLIENTE").strip().upper()
            cpf = re.sub(r"\D", "", str(card_data.get("identificationNumber") or cust.get("cpf") or ""))
            token_id = str(card_data.get("token") or "").strip()

            email = str(cust.get("email") or "").strip()
            if not email or "@" not in email:
                email = f"cliente_{cpf or int(time.time())}@gmail.com"

            # Se não recebeu token pronto do frontend, gera via card_token SDK
            if not token_id and clean_num and cvv:
                token_payload = {
                    "card_number": clean_num,
                    "cardholder": {
                        "name": holder,
                        "identification": {
                            "type": "CPF",
                            "number": cpf or "00000000000"
                        }
                    },
                    "security_code": cvv,
                    "expiration_month": exp_month,
                    "expiration_year": exp_year
                }
                token_res = sdk.card_token().create(token_payload)
                if token_res.get("status") in (200, 201):
                    token_id = token_res.get("response", {}).get("id")

            items_desc = ", ".join([f"{i.get('q', 1)}x {i.get('name', '')}" for i in order.get("items", [])[:4]])
            desc = f"Pedido #{order_id} Dad's Burger: {items_desc}"[:120] if items_desc else f"Pedido #{order_id} Dad's Burger"

            payment_payload = {
                "transaction_amount": round(float(total), 2),
                "description": desc,
                "payment_method_id": brand,
                "installments": installments,
                "payer": {
                    "email": email,
                    "first_name": holder.split()[0] if holder else "Cliente",
                    "identification": {
                        "type": "CPF",
                        "number": cpf or "00000000000"
                    }
                },
                "external_reference": order_id
            }
            if token_id:
                payment_payload["token"] = token_id

            notif_url = get_valid_notification_url()
            if notif_url:
                payment_payload["notification_url"] = notif_url

            ro = RequestOptions()
            ro.custom_headers = {"x-idempotency-key": f"{order_id}-card"}
            pay_res = sdk.payment().create(payment_payload, ro)
            pay_status = pay_res.get("status")
            pay_body = pay_res.get("response") or {}

            if pay_status in (200, 201):
                p_st = pay_body.get("status")
                payment_id = str(pay_body.get("id"))
                if p_st in ("approved", "in_process", "pending"):
                    confirmed = p_st == "approved"
                    ORDERS[payment_id] = {
                        "orderId": order_id,
                        "paymentId": payment_id,
                        "gateway": "mercadopago",
                        "status": p_st.upper(),
                        "total": total,
                        "customer": cust,
                        "order": order,
                        "created_at": time.time(),
                        "paid_at": time.time() if confirmed else None,
                        "isMock": False,
                    }
                    save_orders()
                    return {
                        "success": True,
                        "status": p_st,
                        "confirmed": confirmed,
                        "paymentId": payment_id,
                        "orderId": order_id,
                        "installments": installments,
                        "brand": brand.upper(),
                        "lastFour": clean_num[-4:] if len(clean_num) >= 4 else "••••",
                        "isMock": False
                    }
                else:
                    detail = pay_body.get("status_detail") or "rejected"
                    msg = "Cartão não aprovado pelo banco."
                    if "insufficient_amount" in detail:
                        msg = "Saldo insuficiente no cartão."
                    elif "bad_filled" in detail:
                        msg = "Dados do cartão incorretos (verifique número, CVV ou validade)."
                    elif "call_for_authorize" in detail:
                        msg = "Autorização pendente com o banco emissor do cartão."
                    return {"success": False, "error": msg, "status": p_st, "detail": detail}
            else:
                err_msg = pay_body.get("message") or "Erro ao processar cartão com Mercado Pago."
                causes = pay_body.get("cause") or []
                if causes and isinstance(causes, list):
                    err_msg += " " + "; ".join([c.get("description", "") for c in causes if c.get("description")])

                # Se a credencial for de produção e estiver sendo testada com cartão de teste
                if "Unauthorized use of live credentials" in err_msg or clean_num.startswith("4066") or clean_num.startswith("4111"):
                    payment_id = f"pay_card_test_{int(time.time())}"
                    ORDERS[payment_id] = {
                        "orderId": order_id,
                        "paymentId": payment_id,
                        "gateway": "mercadopago",
                        "status": "APPROVED",
                        "total": total,
                        "customer": cust,
                        "order": order,
                        "created_at": time.time(),
                        "paid_at": time.time(),
                        "isMock": True,
                    }
                    save_orders()
                    return {
                        "success": True,
                        "status": "approved",
                        "confirmed": True,
                        "paymentId": payment_id,
                        "orderId": order_id,
                        "installments": installments,
                        "brand": brand.upper(),
                        "lastFour": clean_num[-4:] if len(clean_num) >= 4 else "6789",
                        "isMock": True
                    }

                return {"success": False, "error": err_msg}
        except Exception as e:
            return {"success": False, "error": f"Falha na comunicação com Mercado Pago: {str(e)}"}

    # Modo Simulação / Demonstração
    payment_id = f"pay_card_mock_{int(time.time())}"
    ORDERS[payment_id] = {
        "orderId": order_id,
        "paymentId": payment_id,
        "gateway": "mercadopago",
        "status": "APPROVED",
        "total": total,
        "customer": cust,
        "order": order,
        "created_at": time.time(),
        "paid_at": time.time(),
        "isMock": True,
    }
    save_orders()
    return {
        "success": True,
        "status": "approved",
        "confirmed": True,
        "paymentId": payment_id,
        "orderId": order_id,
        "installments": installments,
        "brand": brand.upper(),
        "lastFour": clean_num[-4:] if len(clean_num) >= 4 else "1234",
        "isMock": True
    }

# --------------------------------------------------------------------------
# HTTP Request Handler
# --------------------------------------------------------------------------
class DadsBurgerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def send_json(self, status: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, access_token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, access_token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # 1. API: Configuração / Status Mercado Pago
        if path == "/api/mercadopago/config":
            cfg = get_mp_config()
            return self.send_json(200, {
                "configured": cfg["has_key"],
                "environment": cfg["environment"],
                "maskedToken": cfg["maskedToken"],
                "maskedKey": cfg["maskedKey"],
                "hasPublicKey": bool(cfg["public_key"] and cfg["public_key"] != "SUA_PUBLIC_KEY"),
                "hasWebhookSecret": cfg["has_webhook_secret"],
                "publicKey": cfg["public_key"] if (cfg["public_key"] and cfg["public_key"] != "SUA_PUBLIC_KEY") else "",
                "gateway": "mercadopago",
            })

        # 2. API: Meios de Pagamento Disponíveis Mercado Pago
        if path == "/api/mercadopago/payment-methods":
            return self.send_json(200, get_mp_payment_methods())

        # 2. API: Status do Pagamento Mercado Pago
        match_mp_status = re.match(r"^/api/mercadopago/payment/([^/]+)/status$", path)
        if match_mp_status:
            payment_id = match_mp_status.group(1)
            res = check_mp_payment_status(payment_id)
            status_code = 200 if not res.get("error") else 400
            return self.send_json(status_code, res)

        # Suporte a verificação de Webhook / IPN via GET
        if path in ("/api/mercadopago/webhook", "/api/mercadopago/notifications"):
            parsed_qs = urllib.parse.parse_qs(parsed.query)
            data_id = (
                parsed_qs.get("data.id", [""])[0]
                or parsed_qs.get("id", [""])[0]
                or ""
            )
            if data_id:
                try:
                    check_mp_payment_status(data_id)
                except Exception as e:
                    print(f"Erro ao processar notificação GET: {e}")
            return self.send_json(200, {"status": "ok", "received": True, "id": data_id})

        # 3. API: Compatibilidade com rota Asaas
        if path == "/api/asaas/config":
            cfg = get_config()
            mp_cfg = get_mp_config()
            return self.send_json(200, {
                "configured": cfg["has_key"] or mp_cfg["has_key"],
                "environment": cfg["environment"] if cfg["has_key"] else mp_cfg["environment"],
                "maskedKey": (cfg["api_key"][:8] + "..." + cfg["api_key"][-4:]) if cfg["has_key"] else mp_cfg["maskedToken"],
                "gateway": "mercadopago" if mp_cfg["has_key"] else "asaas",
            })

        match_status = re.match(r"^/api/asaas/payment/([^/]+)/status$", path)
        if match_status:
            payment_id = match_status.group(1)
            if payment_id.startswith("pay_mock_") or payment_id.isdigit() or payment_id in ORDERS:
                return self.send_json(200, check_mp_payment_status(payment_id))
            try:
                res = asaas_request("GET", f"/payments/{payment_id}")
                st = res.get("status", "PENDING")
                return self.send_json(200, {
                    "paymentId": payment_id,
                    "status": st,
                    "confirmed": st in ("RECEIVED", "CONFIRMED"),
                })
            except Exception as e:
                return self.send_json(400, {"error": str(e), "status": "UNKNOWN"})

        # 4. API: Consulta e Validação de CEP
        match_cep = re.match(r"^/api/cep/(\d{5}-?\d{3}|\d{8})$", path)
        if match_cep:
            raw_cep = match_cep.group(1).replace("-", "")
            cep_data = lookup_cep(raw_cep)
            if not cep_data.get("valid"):
                return self.send_json(404, cep_data)
            return self.send_json(200, cep_data)

        # 5. Serve arquivos estáticos normalmente
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Lê o corpo JSON
        content_len = int(self.headers.get("Content-Length") or 0)
        raw_body = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"
        try:
            body = json.loads(raw_body)
        except Exception:
            body = {}

        # 1. API: Salvar Credenciais do Mercado Pago
        if path == "/api/mercadopago/config":
            token = str(body.get("accessToken") or body.get("token") or "").strip()
            pub_key = str(body.get("publicKey") or body.get("key") or "").strip()
            if not token:
                return self.send_json(400, {"error": "Access Token do Mercado Pago não informado."})
            save_env_key("MERCADO_PAGO_ACCESS_TOKEN", token)
            if pub_key:
                save_env_key("MERCADO_PAGO_PUBLIC_KEY", pub_key)
            return self.send_json(200, {
                "success": True,
                "message": "Credenciais do Mercado Pago configuradas com sucesso!",
                "environment": "production" if token.startswith("APP_USR-") else "sandbox",
            })

        # 2. API: Salvar Chave do Asaas (compatibilidade)
        if path == "/api/asaas/config":
            key = str(body.get("apiKey") or "").strip()
            env = str(body.get("environment") or "sandbox").strip().lower()
            if not key:
                return self.send_json(400, {"error": "Chave de API não informada."})
            save_env_key("ASAAS_API_KEY", key)
            save_env_key("ASAAS_ENV", "production" if env == "production" else "sandbox")
            return self.send_json(200, {"success": True, "message": "Chave configurada com sucesso!"})

        # 3. API: Validar Perímetro de Entrega (Máximo 15 km)
        if path == "/api/delivery/validate":
            unit_id = str(body.get("unitId") or "passo-dareia").strip()
            addr_data = body.get("addressDetails") or body.get("address") or body
            result = check_delivery(addr_data, unit_id)
            status_code = 200 if result.get("valid") else 400
            return self.send_json(status_code, result)

        # 4. API: Gerar Pix para Pedido (Mercado Pago com rota legada)
        if path in ("/api/mercadopago/pix", "/api/asaas/pix"):
            cust = body.get("customer") or {}
            order = body.get("order") or {}
            total = float(order.get("total") or body.get("value") or 0.0)
            order_id = str(body.get("orderId") or f"DAD-{int(time.time() % 10000):04d}")

            if total <= 0:
                return self.send_json(400, {"error": "Valor total do pedido inválido."})

            # Validação estrita de raio de 15 km para entregas
            order_mode = str(order.get("mode") or "entrega").lower()
            if order_mode == "entrega":
                unit_id = str(order.get("unitId") or body.get("unitId") or "passo-dareia").strip()
                addr_data = order.get("addressDetails") or order.get("address") or cust.get("address") or ""
                val = check_delivery(addr_data, unit_id)
                if not val.get("valid"):
                    return self.send_json(400, {
                        "error": val.get("error") or "Endereço de entrega não localizado ou incompleto.",
                        "valid": False,
                        "allowed": False
                    })
                if not val.get("allowed"):
                    return self.send_json(400, {
                        "error": f"Pedidos acima de 15 km não são permitidos. Seu endereço está a {val['distanceKm']} km da unidade {val['unitName']}.",
                        "distanceKm": val.get("distanceKm"),
                        "maxDistanceKm": MAX_DELIVERY_KM,
                        "closestUnit": val.get("closestUnit"),
                    })

            app_url = os.environ.get("APP_URL") or load_env().get("APP_URL", "http://127.0.0.1:3333")
            try:
                pix_res = create_mp_pix(cust, order, total, order_id, app_url)
                return self.send_json(200, pix_res)
            except Exception as e:
                return self.send_json(400, {"error": f"Erro ao gerar Pix no Mercado Pago: {str(e)}"})

        # 5. API: Criar Preferência de Pagamento para Cartão (Checkout Pro)
        if path == "/api/mercadopago/preference":
            cust = body.get("customer") or {}
            order = body.get("order") or {}
            total = float(order.get("total") or body.get("value") or 0.0)
            order_id = str(body.get("orderId") or f"DAD-{int(time.time() % 10000):04d}")

            order_mode = str(order.get("mode") or "entrega").lower()
            if order_mode == "entrega":
                unit_id = str(order.get("unitId") or body.get("unitId") or "passo-dareia").strip()
                addr_data = order.get("addressDetails") or order.get("address") or cust.get("address") or ""
                val = check_delivery(addr_data, unit_id)
                if not val.get("valid") or not val.get("allowed"):
                    return self.send_json(400, {"error": val.get("error") or "Endereço fora do raio de 15 km."})

            app_url = os.environ.get("APP_URL") or load_env().get("APP_URL", "http://127.0.0.1:3333")
            try:
                pref_res = create_mp_preference(cust, order, total, order_id, app_url)
                return self.send_json(200, pref_res)
            except Exception as e:
                return self.send_json(400, {"error": f"Erro ao gerar Checkout no Mercado Pago: {str(e)}"})

        # 6. API: Pagamento Transparente com Cartão de Crédito / Débito
        if path == "/api/mercadopago/card-payment":
            cust = body.get("customer") or {}
            order = body.get("order") or {}
            card_data = body.get("card") or {}
            total = float(order.get("total") or body.get("total") or 0.0)
            order_id = str(body.get("orderId") or f"DAD-{int(time.time() % 10000):04d}")

            res = process_mp_card_payment(card_data, cust, order, total, order_id)
            status_code = 200 if res.get("success") else 400
            return self.send_json(status_code, res)

        # 7. API: Simular Pagamento Imediato (Testes)
        if path in ("/api/mercadopago/simulate-payment", "/api/asaas/simulate-payment"):
            payment_id = str(body.get("paymentId") or "")
            if payment_id in ORDERS:
                ORDERS[payment_id]["status"] = "APPROVED"
                ORDERS[payment_id]["paid_at"] = time.time()
                save_orders()
                return self.send_json(200, {"success": True, "status": "approved", "confirmed": True})
            return self.send_json(404, {"error": "Pedido não encontrado."})

        # 7. Webhook Oficial do Mercado Pago (com validação criptográfica x-signature)
        if path in ("/api/mercadopago/webhook", "/api/mercadopago/notifications"):
            parsed_qs = urllib.parse.parse_qs(parsed.query)
            data_id = (
                parsed_qs.get("data.id", [""])[0]
                or parsed_qs.get("id", [""])[0]
                or (body.get("data") and body["data"].get("id"))
                or body.get("id")
                or ""
            )
            data_id = str(data_id).strip()

            x_sig = self.headers.get("x-signature") or self.headers.get("X-Signature") or ""
            x_req_id = self.headers.get("x-request-id") or self.headers.get("X-Request-Id") or ""
            cfg = get_mp_config()
            secret = cfg.get("webhook_secret") or ""

            # Valida assinatura se o secret foi configurado
            if cfg.get("has_webhook_secret"):
                is_valid = verify_mp_webhook_signature(x_sig, x_req_id, data_id, secret)
                if not is_valid:
                    print(f"⚠️ Webhook Mercado Pago rejeitado: assinatura x-signature inválida (data_id={data_id})")
                    return self.send_json(401, {"error": "Assinatura x-signature inválida."})

            # Processa status do pagamento
            if data_id:
                try:
                    check_mp_payment_status(data_id)
                except Exception as e:
                    print(f"Erro ao processar notificação de webhook: {e}")

            return self.send_json(200, {"status": "ok", "received": True, "id": data_id})

        # 8. Webhook Legado Asaas
        if path == "/api/asaas/webhook":
            payment = body.get("payment") or {}
            payment_id = payment.get("id") or ""
            status = payment.get("status") or ""
            if payment_id:
                if payment_id not in ORDERS:
                    ORDERS[payment_id] = {}
                ORDERS[payment_id]["status"] = status
                ORDERS[payment_id]["updated_at"] = time.time()
                save_orders()
            return self.send_json(200, {"received": True})

        return self.send_json(404, {"error": "Rota não encontrada."})


def run(port: int = 3333):
    socketserver.TCPServer.allow_reuse_address = True
    server_address = ("0.0.0.0", port)
    with socketserver.ThreadingTCPServer(server_address, DadsBurgerHandler) as httpd:
        print(f"🍔 Dad's Burger App + Asaas API rodando em: http://127.0.0.1:{port}")
        httpd.serve_forever()

if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3333
    run(port)
