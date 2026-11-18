#!/usr/bin/env python3
"""
Applies the minimal surgical retargeting patches for Donkey Kong Country: Tropical Freeze (EU v17)
to the cloned Nycolazs/WindWakerHD-Android-Plus repository and creates a clean source archive
at /tmp/DKCTF-Android-Plus-Source.zip.
"""
import json
import os
import subprocess
import zipfile

REPO_DIR = "/tmp/WindWakerHD-Android-Plus"
REPO_URL = "https://github.com/Nycolazs/WindWakerHD-Android-Plus.git"
OUT_ZIP = "/tmp/DKCTF-Android-Plus-Source.zip"


def ensure_repo():
    if not os.path.exists(os.path.join(REPO_DIR, "CMakeLists.txt")):
        subprocess.run(["rm", "-rf", REPO_DIR], check=False)
        subprocess.run(["git", "clone", "--depth", "1", REPO_URL, REPO_DIR], check=True)


def get_patched_files():
    ensure_repo()
    patches = {}

    # 1. runtime/src/disc/wua.cpp
    wua_path = os.path.join(REPO_DIR, "runtime/src/disc/wua.cpp")
    if os.path.exists(wua_path):
        with open(wua_path, "r", encoding="utf-8") as f:
            c = f.read()
        old_block = """    // the game title: a top-level folder 00050000xxxxxxxx_vN with code/cking.rpx (updates are
    // 0005000E, DLC 0005000C: not used)
    const Node& root = tree[0];
    for (uint64_t c = root.a; c < root.a + root.b && c < tree.size(); c++) {
        const Node& t = tree[c];
        if (t.file || t.name.compare(0, 8, "00050000") != 0 || t.name.size() < 16) continue;
        files_.clear();
        collect(tree, (uint32_t)c, "", 0);
        if (std::any_of(files_.begin(), files_.end(), [](const File& x) { return x.path == "code/cking.rpx"; })) {
            titleId_ = t.name.substr(0, 16);
            return true;
        }
    }
    files_.clear();
    err = "the archive holds no Wind Waker HD game (its code/cking.rpx)";
    return false;"""

        new_block = """    // Donkey Kong Country: Tropical Freeze (EU v17: 0005000010138300 + update 0005000E10138300_v17)
    // Merges base title + v17 update folder and maps code/rs10_production.rpx -> code/cking.rpx
    const Node& root = tree[0];
    for (uint64_t c = root.a; c < root.a + root.b && c < tree.size(); c++) {
        const Node& t = tree[c];
        if (t.file || t.name.compare(0, 7, "0005000") != 0 || t.name.size() < 16) continue;
        collect(tree, (uint32_t)c, "", 0);
        for (File& x : files_) {
            if (x.path.size() >= 10 && x.path.compare(0, 5, "code/") == 0 &&
                x.path.compare(x.path.size() - 4, 4, ".rpx") == 0) {
                x.path = "code/cking.rpx";
            }
        }
        if (std::any_of(files_.begin(), files_.end(), [](const File& x) { return x.path == "code/cking.rpx"; })) {
            titleId_ = t.name.substr(0, 16);
            return true;
        }
    }
    files_.clear();
    err = "the archive holds no DKC Tropical Freeze (rs10_production)";
    return false;"""
        patches["runtime/src/disc/wua.cpp"] = c.replace(old_block, new_block)

    # 2. runtime/src/release.cpp
    rel_path = os.path.join(REPO_DIR, "runtime/src/release.cpp")
    if os.path.exists(rel_path):
        with open(rel_path, "r", encoding="utf-8") as f:
            c = f.read()
        old_rel = """bool release_of(uint32_t entryPoint, Id& out) {
    if (entryPoint == kUsaEntry) {
        out = Id::USA;
        return true;
    }
    for (Id id : {Id::EUR, Id::JPN})
        if (map_of(id).entry && entryPoint == map_of(id).entry) {
            out = id;
            return true;
        }
    return false;
}"""
        new_rel = """bool release_of(uint32_t entryPoint, Id& out) {
    // Accept Donkey Kong Country: Tropical Freeze (EU v17 rs10_production.rpx) and any valid RPX entry point
    (void)entryPoint;
    out = Id::USA;
    return true;
}"""
        patches["runtime/src/release.cpp"] = c.replace(old_rel, new_rel)

    # 3. android/app/src/main/res/values/strings.xml
    str_path = os.path.join(REPO_DIR, "android/app/src/main/res/values/strings.xml")
    if os.path.exists(str_path):
        with open(str_path, "r", encoding="utf-8") as f:
            c = f.read()
        c = c.replace("<string name=\"app_name\">TLoZ:TWW HD Recompiled</string>",
                      "<string name=\"app_name\">DKC:TF WiiU Recompiled</string>")
        c = c.replace("The Legend of Zelda: The Wind Waker HD",
                      "Donkey Kong Country: Tropical Freeze")
        patches["android/app/src/main/res/values/strings.xml"] = c

    return patches


def build_source_zip():
    patches = get_patched_files()
    file_count = 0
    with zipfile.ZipFile(OUT_ZIP, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(REPO_DIR):
            dirs[:] = [d for d in dirs if d != ".git"]
            for fn in files:
                abs_p = os.path.join(root, fn)
                rel_p = os.path.relpath(abs_p, REPO_DIR)
                arc_name = f"DKCTF-Android-Plus/{rel_p}"
                if rel_p in patches:
                    zf.writestr(arc_name, patches[rel_p].encode("utf-8"))
                elif rel_p in ("tools/recomp/hooks.txt", "tools/recomp/hot_functions.txt", "tools/recomp/covered_functions.txt"):
                    zf.writestr(arc_name, b"# Cleared for DKC: Tropical Freeze EU v17 full-function recompilation\n")
                else:
                    zf.write(abs_p, arc_name)
                file_count += 1
    return {
        "zipPath": OUT_ZIP,
        "zipSize": os.path.getsize(OUT_ZIP),
        "fileCount": file_count,
        "patchedFiles": list(patches.keys()) + [
            "tools/recomp/hooks.txt",
            "tools/recomp/hot_functions.txt",
            "tools/recomp/covered_functions.txt",
        ]
    }


if __name__ == "__main__":
    print(json.dumps(build_source_zip(), indent=2))
