import { userSignUp, userSignIn, userActivate, userForgotPassword, userRefreshToken, userBeginResetPassword, userResetPassword } from "../index";
import mockAxios from "axios";
const mockConfig = require("../../../../../config/config.json");

jest.mock("../../../hooks/apiFetch", () => {
    return async (url, method, token, body, onSuccess, onError) => {
        return mockAxios({
            method,
            url: `http://localhost:${mockConfig.apiPort}${url}`,
            headers: {
                Authorization: token ? `Bearer ${token}` : "",
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            data: body,
        })
            .then(res => {
                if (res.status === 204) {
                    onSuccess(undefined);
                } else {
                    onSuccess(res.data);
                }
            })
            .catch(error => {
                if (mockAxios.isCancel(error)) {
                    console.log("Request canceled:", error.message);
                } else {
                    onError(error.response ? error.response.data : error.message);
                }
            });
    };
});
describe("User API", () => {
    describe("Account", () => {
        test("Sign Up Without Username", async () => {
            return userSignUp(
                "",
                "",
                "",
                data => {
                    expect(data).toBe(0);
                },
                res => {
                    expect(res).toMatchObject({
                        status: 400,
                    });
                }
            );
        });

        test("Sign Up With Username", async () => {
            return userSignUp(
                "",
                "a",
                "",
                data => {
                    expect(data).toBe(0);
                },
                res => {
                    expect(res).toMatchObject({
                        status: 400,
                    });
                }
            );
        });

        test("Sign In", () => {
            return userSignIn(
                "",
                "",
                data => {
                    expect(data).toBe(0);
                },
                res => {
                    expect(res).toMatchObject({
                        status: 400,
                    });
                }
            );
        });

        test("Activate", () => {
            return userActivate(
                "a",
                data => {
                    expect(data).toBe(0);
                },
                res => {
                    expect(res).toMatchObject({
                        status: 400,
                    });
                }
            );
        });

        test("Forgot Password", () => {
            return userForgotPassword(
                "",
                data => {
                    expect(data).toBe(0);
                },
                res => {
                    expect(res).toMatchObject({
                        status: 400,
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
                        status: 401,
                    });
                }
            );
        });

        test("Begin Reset Password", () => {
            return userBeginResetPassword(
                "a",
                data => {
                    expect(data).toBe(0);
                },
                res => {
                    expect(res).toMatchObject({
                        status: 400,
                    });
                }
            );
        });

        test("Reset Password", () => {
            return userResetPassword(
                "a",
                "",
                data => {
                    expect(data).toBe(0);
                },
                res => {
                    expect(res).toMatchObject({
                        status: 400,
                    });
                }
            );
        });
    });
});
