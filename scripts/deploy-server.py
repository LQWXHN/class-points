#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""部署脚本：上传 app/src 和 web/ 到服务器，重启服务"""
import paramiko
import os
import sys
import time

HOST = '192.168.x.x'
USER = 'root'
PASS = '<SSH-密码-部署时填写>'
LOCAL = r'F:\DESKTOP\班级积分系统'
REMOTE = '/home/class-points'
REMOTE_FOUND = None

def run(ssh, cmd, timeout=30):
    print(f'$ {cmd}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out.strip(): print(out.rstrip())
    if err.strip(): print('ERR:', err.rstrip())
    return out, err

def upload_dir(sftp, local_dir, remote_dir, prefix=''):
    """递归上传目录"""
    items = os.listdir(local_dir)
    for item in items:
        local_path = os.path.join(local_dir, item)
        remote_path = remote_dir + '/' + item
        rel = prefix + '/' + item if prefix else item
        if os.path.isdir(local_path):
            try:
                sftp.stat(remote_path)
            except FileNotFoundError:
                sftp.mkdir(remote_path)
            upload_dir(sftp, local_path, remote_path, rel)
        else:
            # 跳过 node_modules 和 .wrangler
            if 'node_modules' in rel or '.wrangler' in rel:
                continue
            sftp.put(local_path, remote_path)
            print(f'  ↑ {rel}')

def main():
    print('=== 连接服务器 ===')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=15)
    sftp = ssh.open_sftp()
    print('已连接')

    # 确认远程路径
    out, _ = run(ssh, f'ls -d {REMOTE} 2>/dev/null && echo EXISTS || echo MISSING')
    if 'MISSING' in out:
        # 试试 /opt
        out2, _ = run(ssh, 'ls -d /opt/class-points 2>/dev/null && echo EXISTS || echo MISSING')
        if 'EXISTS' in out2:
            REMOTE_FOUND = '/opt/class-points'
            print(f'实际路径: {REMOTE_FOUND}')
        else:
            print('ERROR: 找不到项目目录')
            ssh.close()
            sys.exit(1)
    else:
        REMOTE_FOUND = REMOTE
    remote_base = REMOTE_FOUND

    print(f'\n=== 上传 app/src ===')
    upload_dir(sftp, os.path.join(LOCAL, 'app', 'src'), remote_base + '/app/src')

    print(f'\n=== 上传 web/ ===')
    upload_dir(sftp, os.path.join(LOCAL, 'web'), remote_base + '/web')

    print(f'\n=== 上传 scripts/migrate-v42.sql ===')
    try:
        sftp.stat(remote_base + '/scripts')
    except FileNotFoundError:
        sftp.mkdir(remote_base + '/scripts')
    sftp.put(os.path.join(LOCAL, 'scripts', 'migrate-v42.sql'), remote_base + '/scripts/migrate-v42.sql')
    print('  ↑ scripts/migrate-v42.sql')

    sftp.close()

    print(f'\n=== 重启服务 ===')
    run(ssh, 'systemctl restart class-points', timeout=15)
    time.sleep(3)
    run(ssh, 'systemctl status class-points --no-pager | head -8', timeout=10)

    print(f'\n=== 验证端口 ===')
    run(ssh, 'ss -tlnp | grep -E "8787|3000" || netstat -tlnp 2>/dev/null | grep -E "8787|3000"', timeout=10)

    print(f'\n=== 最近日志 ===')
    run(ssh, 'journalctl -u class-points -n 15 --no-pager', timeout=10)

    ssh.close()
    print('\n=== 部署完成 ===')

if __name__ == '__main__':
    main()
