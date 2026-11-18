#!/usr/bin/env python3
"""Build and verify the separately installed, privately signed Aegis client.

Author: Olshansky Grigory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile


def run(*arguments, **kwargs):
    """Run the build without exposing the signing environment."""
    return subprocess.run(arguments, check=True, **kwargs)


def verify_source(source, expected):
    """Reject a release whose tracked input or commit changed during compilation."""
    commit = run('git', 'rev-parse', 'HEAD', cwd=source, stdout=subprocess.PIPE, text=True).stdout.strip()
    if commit != expected:
        raise RuntimeError('Source commit changed during the release build')
    status = run('git', 'status', '--porcelain', '--untracked-files=no',
                 cwd=source, stdout=subprocess.PIPE, text=True).stdout
    if status:
        raise RuntimeError('Tracked source changed; the release is not accepted')


def pin_source(source):
    """Bind the build to its clean starting commit before any generated work."""
    commit = run('git', 'rev-parse', 'HEAD', cwd=source, stdout=subprocess.PIPE, text=True).stdout.strip()
    verify_source(source, commit)
    return commit


def main():
    """Keep release signing separate from distributable source and verify the APK."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credentials', type=Path, required=True)
    parser.add_argument('--keystore', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    mobile = Path(__file__).resolve().parents[1]
    source = mobile.parent
    commit = pin_source(source)
    credential = json.loads(args.credentials.read_text())
    if not args.keystore.is_file() or args.keystore.resolve().is_relative_to(source):
        raise ValueError('Use the preserved signing key from private storage outside the source checkout')
    if args.credentials.stat().st_mode & 0o077:
        raise PermissionError('Signing credentials must be private to their owner')
    expected = credential['certificate_sha256'].lower().replace(':', '')
    environment = {**os.environ, 'AEGIS_BUILD': 'true',
                   'IMMICH_SIGNING_KEY_FILE': str(args.keystore.resolve()),
                   'ALIAS': credential['alias'],
                   'ANDROID_KEY_PASSWORD': credential['password'],
                   'ANDROID_STORE_PASSWORD': credential['password']}
    environment.pop('PR_NUMBER', None)
    run('mise', '//mobile:codegen', cwd=source)
    verify_source(source, commit)
    environment.pop('C_INCLUDE_PATH', None)
    run('flutter', 'build', 'apk', '--release', '--target-platform', 'android-arm64',
        '-P', 'disable-abi-filtering=true',
        '--dart-define=AEGIS_BUILD=true', cwd=mobile, env=environment)
    verify_source(source, commit)
    sdk = Path(os.environ.get('ANDROID_HOME') or os.environ['ANDROID_SDK_ROOT'])
    tools = sorted((sdk / 'build-tools').iterdir(), key=lambda p: tuple(map(int, p.name.split('.'))))[-1]
    apk = mobile / 'build/app/outputs/flutter-apk/app-release.apk'
    certificate = run(str(tools / 'apksigner'), 'verify', '--print-certs', str(apk),
                      stdout=subprocess.PIPE, text=True).stdout
    match = re.search(r'Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)', certificate)
    if not match or match.group(1).lower() != expected:
        raise RuntimeError('The APK signer differs from the preserved Aegis identity')
    badging = run(str(tools / 'aapt'), 'dump', 'badging', str(apk),
                  stdout=subprocess.PIPE, text=True).stdout
    identity = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    if not identity or identity[1] != 'app.alextran.immich.aegis':
        raise RuntimeError('The APK must coexist with the official Immich application')
    with zipfile.ZipFile(apk) as archive:
        abis = sorted({name.split('/')[1] for name in archive.namelist() if name.startswith('lib/')})
    if abis != ['arm64-v8a']:
        raise RuntimeError(f'Unexpected native ABI set in the Pixel release: {abis}')
    args.output.mkdir(parents=True, exist_ok=True)
    target = args.output / 'immich-aegis-arm64.apk'
    shutil.copyfile(apk, target)
    flutter = json.loads(run('flutter', '--no-version-check', '--version', '--machine',
                             stdout=subprocess.PIPE, text=True).stdout)
    with target.open('rb') as stream:
        checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
    result = {'application_id': identity[1], 'version_code': int(identity[2]), 'version_name': identity[3],
              'source_commit': commit, 'certificate_sha256': expected, 'abis': abis,
              'sha256': checksum,
              'bytes': target.stat().st_size, 'flutter': flutter['frameworkVersion'],
              'dart': flutter['dartSdkVersion'], 'android_build_tools': tools.name}
    (args.output / 'APK.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
