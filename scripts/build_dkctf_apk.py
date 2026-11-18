#!/usr/bin/env python3
"""
Surgical binary patcher and APK Signature Scheme v2 signer that adapts
Nycolazs/WindWakerHD-Android-Plus (v1.14) to Donkey Kong Country: Tropical Freeze (EU v17 .wua).
"""
import hashlib
import json
import os
import struct
import subprocess
import sys
import time
import zlib

BASE_APK = "/tmp/wwhd-v1.14.apk"
BASE_APK_URL = "https://github.com/Nycolazs/WindWakerHD-Android-Plus/releases/download/v1.14/WindWakerHD-Android-Plus-v1.14.apk"
OUT_APK = "/tmp/DKCTF-Android-Plus-EU-v17.apk"
KEY_PATH = "/tmp/dkctf.key"
CERT_DER_PATH = "/tmp/dkctf.crt.der"
PUB_DER_PATH = "/tmp/dkctf.pub.der"


def ensure_base_apk():
    if not os.path.exists(BASE_APK) or os.path.getsize(BASE_APK) < 60_000_000:
        subprocess.run(["curl", "-sL", "-o", BASE_APK, BASE_APK_URL], check=True)



def ensure_keys():
    if not (os.path.exists(KEY_PATH) and os.path.exists(CERT_DER_PATH) and os.path.exists(PUB_DER_PATH)):
        subprocess.run([
            "openssl", "req", "-new", "-x509", "-nodes", "-newkey", "rsa:2048",
            "-keyout", KEY_PATH, "-out", CERT_DER_PATH, "-outform", "DER",
            "-days", "10000", "-subj", "/CN=DKCTF Android Plus/O=Nycolazs Port Studio/C=EU"
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run([
            "openssl", "rsa", "-in", KEY_PATH, "-pubout", "-outform", "DER", "-out", PUB_DER_PATH
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def v2f(vaddr: int) -> int:
    # PT_LOAD 2 (.text) has file_offset = vaddr - 0x4000
    return vaddr - 0x4000


def build_aarch64_rpx_matcher() -> bytes:
    """
    37-instruction (148-byte) AArch64 leaf function at vaddr 0x1198b34
    replacing the inlined std::any_of(files_.begin(), files_.end(), path == "code/cking.rpx").
    Matches any "code/*.rpx" (including "code/rs10_production.rpx" in DKC: Tropical Freeze EU v17),
    maps its extracted relative path in-place to "code/cking.rpx", and returns true (1).
    """
    base = 0x1198b34
    imm_pages = (0x6ab000 - (base & ~0xfff)) >> 12
    imm21 = imm_pages & ((1 << 21) - 1)
    immlo = imm21 & 3
    immhi = (imm21 >> 2) & 0x7ffff

    insns = [
        # Load "code/cki" (x9) and "ing.rpx\0" (x10) from .rodata @ 0x6abc11
        (1 << 31) | (immlo << 29) | (0b10000 << 24) | (immhi << 5) | 16,          # 00: adrp x16, 0x6ab000
        (1 << 31) | (0b001000100 << 22) | (0xc11 << 10) | (16 << 5) | 16,         # 01: add x16, x16, #0xc11
        0xf9400000 | (16 << 5) | 9,                                               # 02: ldr x9, [x16]
        0xf8400000 | ((7 & 0x1ff) << 12) | (16 << 5) | 10,                        # 03: ldur x10, [x16, #7]
        0xd340fc00 | (24 << 16) | (10 << 5) | 11,                                 # 04: lsr x11, x10, #24 (".rpx")
        # loop (idx 5):
        0xeb01001f,                                                               # 05: cmp x0, x1
        0x54000000 | ((18 & 0x7ffff) << 5) | 0x0,                                 # 06: b.eq not_found (idx 24)
        0x39400000 | (0 << 5) | 12,                                               # 07: ldrb w12, [x0]
        0xf9400400 | (0 << 5) | 13,                                               # 08: ldr x13, [x0, #8]
        0xd341fc00 | (12 << 5) | 14,                                              # 09: lsr x14, x12, #1
        0x7200019f,                                                               # 10: tst w12, #1
        0x9a8d01cd,                                                               # 11: csel x13, x14, x13, eq (size)
        0xf9400800 | (0 << 5) | 14,                                               # 12: ldr x14, [x0, #16]
        0x91000400 | (0 << 5) | 15,                                               # 13: add x15, x0, #1
        0x9a8e01ee,                                                               # 14: csel x14, x15, x14, eq (data)
        0xb9400000 | (14 << 5) | 15,                                              # 15: ldr w15, [x14]
        0x6b0901ff,                                                               # 16: cmp w15, w9 ("code")
        0x54000000 | ((5 & 0x7ffff) << 5) | 0x1,                                  # 17: b.ne next (idx 22)
        0xd1001000 | (13 << 5) | 15,                                              # 18: sub x15, x13, #4
        0xb8606800 | (15 << 16) | (14 << 5) | 15,                                 # 19: ldr w15, [x14, x15]
        0x6b0b01ff,                                                               # 20: cmp w15, w11 (".rpx")
        0x54000000 | ((5 & 0x7ffff) << 5) | 0x0,                                  # 21: b.eq found (idx 26)
        # next (idx 22):
        0x9100a000 | (0 << 5) | 0,                                                # 22: add x0, x0, #0x28
        0x14000000 | ((-18) & 0x3ffffff),                                         # 23: b loop (idx 5)
        # not_found (idx 24):
        0x2a1f03e0,                                                               # 24: mov w0, wzr
        0xd65f03c0,                                                               # 25: ret
        # found (idx 26):
        0xf9000000 | (14 << 5) | 9,                                               # 26: str x9, [x14]
        0xf8000000 | ((7 & 0x1ff) << 12) | (14 << 5) | 10,                        # 27: stur x10, [x14, #7]
        0x36000000 | ((5 & 0x3fff) << 5) | 12,                                    # 28: tbz w12, #0, is_short (idx 33)
        0xd28001cd,                                                               # 29: mov x13, #14
        0xf9000400 | (0 << 5) | 13,                                               # 30: str x13, [x0, #8]
        0x52800020,                                                               # 31: mov w0, #1
        0xd65f03c0,                                                               # 32: ret
        # is_short (idx 33):
        0x5280038d,                                                               # 33: mov w13, #28
        0x39000000 | (0 << 5) | 13,                                               # 34: strb w13, [x0]
        0x52800020,                                                               # 35: mov w0, #1
        0xd65f03c0,                                                               # 36: ret
    ]
    assert len(insns) == 37
    return b"".join(struct.pack("<I", w) for w in insns)


def len_prefixed(b: bytes) -> bytes:
    return struct.pack("<I", len(b)) + b


def compute_v2_merkle_digest(sec1: memoryview, sec3: memoryview, eocd: bytes) -> bytes:
    chunk_digests = []
    chunk_size = 1024 * 1024
    for sec in (sec1, sec3, memoryview(eocd)):
        pos = 0
        n = len(sec)
        while pos < n:
            chunk = sec[pos:min(pos + chunk_size, n)]
            h = hashlib.sha512()
            h.update(b"\xa5")
            h.update(struct.pack("<I", len(chunk)))
            h.update(chunk)
            chunk_digests.append(h.digest())
            pos += chunk_size

    top = hashlib.sha512()
    top.update(b"\x5a")
    top.update(struct.pack("<I", len(chunk_digests)))
    for d in chunk_digests:
        top.update(d)
    return top.digest()


def build_apk_sig_block_v2(top_digest: bytes, target_total_size: int = 4096) -> bytes:
    ensure_keys()
    with open(CERT_DER_PATH, "rb") as f:
        cert_der = f.read()
    with open(PUB_DER_PATH, "rb") as f:
        pub_der = f.read()

    # Signature Algorithm ID 0x0104 = RSASSA-PKCS1-v1_5 with SHA2-512
    algo_id = 0x0104
    digest_entry = struct.pack("<I", algo_id) + len_prefixed(top_digest)
    digests = len_prefixed(digest_entry)
    certs = len_prefixed(cert_der)
    additional_attrs = b""

    signed_data = len_prefixed(digests) + len_prefixed(certs) + len_prefixed(additional_attrs)

    # Sign signed_data with RSA-SHA512 via openssl
    proc = subprocess.run(
        ["openssl", "dgst", "-sha512", "-sign", KEY_PATH],
        input=signed_data, capture_output=True, check=True
    )
    sig_bytes = proc.stdout

    sig_entry = struct.pack("<I", algo_id) + len_prefixed(sig_bytes)
    signatures = len_prefixed(sig_entry)

    signer = len_prefixed(signed_data) + len_prefixed(signatures) + len_prefixed(pub_der)
    v2_block_value = len_prefixed(len_prefixed(signer))

    pair_v2 = struct.pack("<QI", len(v2_block_value) + 4, 0x7109871A) + v2_block_value

    # Pad block to target_total_size (4096 bytes) using VERITY_PADDING_BLOCK_ID (0x42726577)
    # Total block = 8 (size_header) + pairs + 8 (size_footer) + 16 (magic)
    overhead = 8 + len(pair_v2) + 8 + 16
    if overhead + 12 <= target_total_size:
        pad_len = target_total_size - overhead - 12
        pair_pad = struct.pack("<QI", pad_len + 4, 0x42726577) + (b"\x00" * pad_len)
        pairs = pair_v2 + pair_pad
    else:
        pairs = pair_v2

    size_field = len(pairs) + 8 + 16
    block = (
        struct.pack("<Q", size_field) +
        pairs +
        struct.pack("<Q", size_field) +
        b"APK Sig Block 42"
    )
    return block


def find_zip_entries(buf: bytearray, cd_offset: int, cd_size: int):
    entries = {}
    pos = cd_offset
    end = cd_offset + cd_size
    while pos < end:
        assert buf[pos:pos + 4] == b"PK\x01\x02"
        comp_method = struct.unpack_from("<H", buf, pos + 10)[0]
        crc32 = struct.unpack_from("<I", buf, pos + 16)[0]
        comp_size = struct.unpack_from("<I", buf, pos + 20)[0]
        uncomp_size = struct.unpack_from("<I", buf, pos + 24)[0]
        fname_len, extra_len, comment_len = struct.unpack_from("<HHH", buf, pos + 28)
        lh_offset = struct.unpack_from("<I", buf, pos + 42)[0]
        fname = bytes(buf[pos + 46:pos + 46 + fname_len]).decode("utf-8", "replace")

        # Local file header
        assert buf[lh_offset:lh_offset + 4] == b"PK\x03\x04"
        lh_fname_len, lh_extra_len = struct.unpack_from("<HH", buf, lh_offset + 26)
        data_offset = lh_offset + 30 + lh_fname_len + lh_extra_len

        entries[fname] = {
            "cd_pos": pos,
            "lh_offset": lh_offset,
            "data_offset": data_offset,
            "comp_size": comp_size,
            "uncomp_size": uncomp_size,
            "comp_method": comp_method,
            "crc32": crc32,
        }
        pos += 46 + fname_len + extra_len + comment_len
    return entries


def update_entry_crc(buf: bytearray, info: dict):
    d_start = info["data_offset"]
    d_end = d_start + info["comp_size"]
    new_crc = zlib.crc32(memoryview(buf)[d_start:d_end]) & 0xFFFFFFFF
    struct.pack_into("<I", buf, info["lh_offset"] + 14, new_crc)
    struct.pack_into("<I", buf, info["cd_pos"] + 16, new_crc)
    return new_crc


def build_patched_apk(rebrand_ui: bool = True) -> dict:
    t0 = time.time()
    ensure_base_apk()
    with open(BASE_APK, "rb") as f:
        buf = bytearray(f.read())

    eocd_pos = buf.rfind(b"PK\x05\x06")
    cd_size = struct.unpack_from("<I", buf, eocd_pos + 12)[0]
    cd_offset = struct.unpack_from("<I", buf, eocd_pos + 16)[0]
    block_size_footer = struct.unpack_from("<Q", buf, cd_offset - 24)[0]
    block_start = cd_offset - 8 - block_size_footer

    entries = find_zip_entries(buf, cd_offset, cd_size)
    so_info = entries["lib/arm64-v8a/libwwhd.so"]
    arsc_info = entries["resources.arsc"]

    so_base = so_info["data_offset"]

    # 1. Patch disc::Archive::open title prefix length (8 -> 7) and "00050000" -> "0005000\0"
    # so both base title (0005000010138300) and EU v17 update (0005000e10138300) folders match
    struct.pack_into("<I", buf, so_base + v2f(0x11983A8), 0x528000E2)  # mov w2, #7
    buf[so_base + 0x6D0BE8] = 0x00                                     # "0005000\0"

    # 2. Patch disc::Archive::open files_.clear() inside top-level loop to NOP so base + v17 merge
    struct.pack_into("<I", buf, so_base + v2f(0x11983DC), 0xD503201F)  # nop

    # 3. Patch disc::Archive::open RPX matcher (0x1198b34 .. 0x1198bc4, 148 bytes)
    matcher_bytes = build_aarch64_rpx_matcher()
    buf[so_base + v2f(0x1198B34):so_base + v2f(0x1198B34) + len(matcher_bytes)] = matcher_bytes

    # 4. Patch release::release_of (0x11eded8) to accept any RPX entry point (DKCTF EU v17)
    struct.pack_into("<III", buf, so_base + v2f(0x11EDED8),
                     0xB900003F,  # str wzr, [x1] (Id::USA)
                     0x52800020,  # mov w0, #1    (return true)
                     0xD65F03C0)  # ret

    # 5. Set wwhd_jit_count = 0 (0x84642c) and clear WWHD-specific hook/hot/covered address lists
    struct.pack_into("<I", buf, so_base + 0x84642C, 0)
    buf[so_base + 0x7E9820:so_base + 0x81641F] = b"\n" * (0x81641F - 0x7E9820)
    buf[so_base + 0x8422C0:so_base + 0x845EFE] = b"\n" * (0x845EFE - 0x8422C0)

    # 6. Update diagnostic error message in .rodata (exact 60-byte replacement)
    old_err = b"the archive holds no Wind Waker HD game (its code/cking.rpx)"
    new_err = b"the archive holds no DKC Tropical Freeze (rs10_production)  "
    assert len(old_err) == len(new_err)
    buf[so_base + 0x7C9B83:so_base + 0x7C9B83 + len(new_err)] = new_err

    so_crc = update_entry_crc(buf, so_info)

    # 7. Optional UI string rebranding in resources.arsc (exact byte-length replacements)
    arsc_crc = arsc_info["crc32"]
    if rebrand_ui:
        arsc_start = arsc_info["data_offset"]
        arsc_end = arsc_start + arsc_info["comp_size"]
        arsc_slice = bytes(buf[arsc_start:arsc_end])

        replacements = [
            (b"TLoZ:TWW HD Recompiled", b"DKC:TF WiiU Recompiled"),
            (b"The Legend of Zelda: The Wind Waker HD", b"Donkey Kong Country: Tropical Freeze  "),
        ]
        for old_s, new_s in replacements:
            assert len(old_s) == len(new_s)
            arsc_slice = arsc_slice.replace(old_s, new_s)

        buf[arsc_start:arsc_end] = arsc_slice
        arsc_crc = update_entry_crc(buf, arsc_info)

    # 8. Recompute APK Signature Scheme v2 block and write output APK
    sec1 = memoryview(buf)[0:block_start]
    sec3 = memoryview(buf)[cd_offset:eocd_pos]
    eocd_for_hash = bytearray(buf[eocd_pos:])
    struct.pack_into("<I", eocd_for_hash, 16, block_start)

    top_digest = compute_v2_merkle_digest(sec1, sec3, eocd_for_hash)
    new_sig_block = build_apk_sig_block_v2(top_digest, target_total_size=cd_offset - block_start)
    assert len(new_sig_block) == (cd_offset - block_start)

    buf[block_start:cd_offset] = new_sig_block

    with open(OUT_APK, "wb") as f:
        f.write(buf)

    sha256_hex = hashlib.sha256(buf).hexdigest()
    elapsed = round(time.time() - t0, 2)
    return {
        "apkPath": OUT_APK,
        "apkSize": len(buf),
        "sha256": sha256_hex,
        "merkleDigestSha512": top_digest.hex(),
        "libwwhdCrc32": f"{so_crc:08x}",
        "resourcesArscCrc32": f"{arsc_crc:08x}",
        "elapsedSeconds": elapsed,
    }


if __name__ == "__main__":
    res = build_patched_apk(rebrand_ui=True)
    print(json.dumps(res, indent=2))
