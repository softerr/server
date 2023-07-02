import { userSignUp, userSignIn, userActivate, userForgotPassword, userRefreshToken, userBeginResetPassword, userResetPassword, updateUser, getUsers } from "../index"

jest.mock("../../../hooks/apiFetch", () => {
    return async (url, method, token, body, onSuccess, onError) => {
        return fetch(url, {
            method,
            headers: {
                Authorization: token ? "Bearer " + token : "",
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        }).then(async res => {
            if (res.ok) {
                onSuccess(res.status === 204 ? undefined : await res.json());
            } else {
                onError(await res.json());
            }
        });
    };
})

describe("User API", () => {
    test("Sign Up Without Username", async () => {
        return userSignUp("", "", "",
            data => {
                expect(data).toBe(0);
            },
            res => {
                expect(res).toMatchObject({
                    status: 400
                });
            }
        );
    });

    test("Sign Up With Username", async () => {
        return userSignUp("", "a", "",
            data => {
                expect(data).toBe(0);
            },
            res => {
                expect(res).toMatchObject({
                    status: 400
                });
            }
        );
    });

    test("Sign In", () => {
        return userSignIn("", "",
            data => {
                expect(data).toBe(0);
            },
            res => {
                expect(res).toMatchObject({
                    status: 400
                });
            }
        );
    });

    test("Activate", () => {
        return userActivate("a",
            data => {
                expect(data).toBe(0);
            },
            res => {
                expect(res).toMatchObject({
                    status: 400
                });
            }
        );
    });

    test("Forgot Password", () => {
        return userForgotPassword("",
            data => {
                expect(data).toBe(0);
            },
            res => {
                expect(res).toMatchObject({
                    status: 400
                });
            }
        );
    });

    test("Refresh Token", () => {
        return userRefreshToken(
            data => {
                expect(data).toBe(0);
            },
            res => {
                expect(res).toMatchObject({
                    status: 401
                });
            }
        );
    });

    test("Begin Reset Password", () => {
        return userBeginResetPassword("a",
            data => {
                expect(data).toBe(0);
            },
            res => {
                expect(res).toMatchObject({
                    status: 400
                });
            }
        );
    });

    test("Reset Password", () => {
        return userResetPassword("a", "",
            data => {
                expect(data).toBe(0);
            },
            res => {
                expect(res).toMatchObject({
                    status: 400
                });
            }
        );
    });

    test("Update", () => {
        return updateUser("", 0, undefined,
            data => {
                expect(data).toBe(0);
            },
            res => {
                expect(res).toMatchObject({
                    status: 401
                });
            }
        );
    });

    test("Get All", () => {
        return getUsers("",
            data => {
                expect(data).toBe(0);
            },
            res => {
                expect(res).toMatchObject({
                    status: 401
                });
            }
        );
    });
});
