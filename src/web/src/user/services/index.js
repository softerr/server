import apiFetch from "../../hooks/apiFetch";

export function userSignUp(email, username, password, onSuccess, onError) {
    return apiFetch(
        "/api/users/signup",
        "POST",
        undefined,
        username.length === 0 ? { email, password } : { email, username, password },
        onSuccess,
        onError
    );
}

export function userSignIn(email, password, onSuccess, onError) {
    return apiFetch(
        "/api/users/signin",
        "POST",
        undefined,
        { email, password },
        onSuccess,
        onError
    );
}

export function userActivate(token, onSuccess, onError) {
    return apiFetch(
        `/api/users/activate/${token}`,
        "POST",
        undefined,
        undefined,
        onSuccess,
        onError
    );
}

export function userForgotPassword(email, onSuccess, onError) {
    return apiFetch(
        "/api/users/forgot_password",
        "POST",
        undefined,
        { email },
        onSuccess,
        onError
    );
}

export function userRefreshToken(onSuccess, onError) {
    return apiFetch(
        "/api/users/refresh",
        "POST",
        undefined,
        undefined,
        onSuccess,
        onError
    );
}

export function userBeginResetPassword(token, onSuccess, onError) {
    return apiFetch(
        `/api/users/begin_reset_password/${token}`,
        "POST",
        undefined,
        undefined,
        onSuccess,
        onError
    );
}

export function userResetPassword(resetToken, password, onSuccess, onError) {
    return apiFetch(
        `/api/users/reset_password/${resetToken}`,
        "POST",
        undefined,
        { password },
        onSuccess,
        onError
    );
}
