import { useState } from 'react';

export default function LoginForm({ onSubmit, pending, error, mode = 'local', onCenterLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const ready = username.trim() && password;

  if (mode === 'center') {
    return (
      <form className="login-card login-center" onSubmit={(event) => event.preventDefault()}>
        <h2>用户中心登录</h2>
        <p className="hint">口令在用户中心填写。试穿账号不会在这里自行注册。</p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" onClick={onCenterLogin}>
          重新登录
        </button>
      </form>
    );
  }

  return (
    <form
      className="login-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || pending) return;
        onSubmit(username.trim(), password);
      }}
    >
      <h2>请先登录</h2>
      <p className="hint">登录后才能打开摄像头和试穿。</p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <label>
        账号
        <input
          name="username"
          autoComplete="username"
          value={username}
          placeholder="手机号或账号"
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label>
        密码
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button type="submit" disabled={pending || !ready}>
        {pending ? '正在登录…' : '登录'}
      </button>
    </form>
  );
}
