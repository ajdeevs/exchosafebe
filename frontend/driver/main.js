(() => {
  const tabSignup = document.getElementById('tab-signup');
  const tabSignin = document.getElementById('tab-signin');
  const formSignup = document.getElementById('form-signup');
  const formSignin = document.getElementById('form-signin');

  const suEmail = document.getElementById('su-email');
  const suPassword = document.getElementById('su-password');
  const suName = document.getElementById('su-name');
  const suLicenseNumber = document.getElementById('su-license-number');
  const suLicensePlate = document.getElementById('su-license-plate');
  const suDeviceId = document.getElementById('su-device-id');
  const btnSignup = document.getElementById('btn-signup');
  const signupStatus = document.getElementById('signup-status');

  const siEmail = document.getElementById('si-email');
  const siPassword = document.getElementById('si-password');
  const btnSignin = document.getElementById('btn-signin');
  const signinStatus = document.getElementById('signin-status');

  const tokenBox = document.getElementById('token-box');
  const wsSnippet = document.getElementById('ws-snippet');

  let lastProfile = null;
  let lastToken = null;

  function setStatus(el, text, isError) {
    el.classList.toggle('error', !!isError);
    const span = el.querySelector('span:last-child');
    if (span) span.textContent = text;
  }

  function renderToken(token) {
    tokenBox.innerHTML = '';
    const label = document.createElement('div');
    label.className = 'small-label';
    label.textContent = 'JWT (role: CAB_DEVICE)';
    const pre = document.createElement('div');
    pre.innerHTML = `<code>${token}</code>`;
    tokenBox.appendChild(label);
    tokenBox.appendChild(pre);
  }

  function renderWsSnippet() {
    wsSnippet.innerHTML = '';
    if (!lastProfile || !lastToken) {
      const span = document.createElement('span');
      span.className = 'small-label';
      span.textContent = 'Waiting for driver profile…';
      wsSnippet.appendChild(span);
      return;
    }
    const rideId = 'ride123'; // operator system will generate actual rideId
    const payload = {
      type: 'REGISTER',
      payload: {
        role: 'CAB_DEVICE',
        rideId,
        token: 'PASTE_DRIVER_TOKEN_HERE'
      }
    };
    const label = document.createElement('div');
    label.className = 'small-label';
    label.textContent = 'Send this as first WS message from cab device:';
    const code = document.createElement('pre');
    code.textContent = JSON.stringify(payload, null, 2);
    wsSnippet.appendChild(label);
    wsSnippet.appendChild(code);
  }

  async function request(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let data;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const message = (data && data.error) || `HTTP ${res.status}`;
      throw new Error(message);
    }
    return data;
  }

  async function handleSignup() {
    const email = suEmail.value.trim();
    const password = suPassword.value.trim();
    const fullName = suName.value.trim();
    const licenseNumber = suLicenseNumber.value.trim();
    const licensePlate = suLicensePlate.value.trim();
    const cabDeviceId = suDeviceId.value.trim() || undefined;

    if (!email || !password || !fullName || !licenseNumber || !licensePlate) {
      setStatus(signupStatus, 'Fill all required fields', true);
      return;
    }

    btnSignup.disabled = true;
    setStatus(signupStatus, 'Creating profile…', false);

    try {
      const data = await request('/auth/driver/signup', {
        email,
        password,
        fullName,
        licenseNumber,
        licensePlate,
        cabDeviceId
      });
      lastToken = data.token;
      lastProfile = data.user;
      setStatus(signupStatus, 'SAFE profile created', false);
      renderToken(lastToken);
      renderWsSnippet();
    } catch (err) {
      console.error(err);
      setStatus(signupStatus, err.message || 'Signup failed', true);
    } finally {
      btnSignup.disabled = false;
    }
  }

  async function handleSignin() {
    const email = siEmail.value.trim();
    const password = siPassword.value.trim();
    if (!email || !password) {
      setStatus(signinStatus, 'Email and password required', true);
      return;
    }

    btnSignin.disabled = true;
    setStatus(signinStatus, 'Signing in…', false);

    try {
      const data = await request('/auth/driver/signin', { email, password });
      lastToken = data.token;
      lastProfile = data.user;
      setStatus(signinStatus, 'Signed in', false);
      renderToken(lastToken);
      renderWsSnippet();
    } catch (err) {
      console.error(err);
      setStatus(signinStatus, err.message || 'Signin failed', true);
    } finally {
      btnSignin.disabled = false;
    }
  }

  function showSignup() {
    formSignup.style.display = '';
    formSignin.style.display = 'none';
    tabSignup.classList.add('active');
    tabSignin.classList.remove('active');
  }

  function showSignin() {
    formSignup.style.display = 'none';
    formSignin.style.display = '';
    tabSignup.classList.remove('active');
    tabSignin.classList.add('active');
  }

  tabSignup.addEventListener('click', showSignup);
  tabSignin.addEventListener('click', showSignin);
  btnSignup.addEventListener('click', handleSignup);
  btnSignin.addEventListener('click', handleSignin);

  renderWsSnippet();
})();

