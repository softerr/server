import { quizSignIn, getModQuizzes, updateModQuiz, getModQuizQuestions, getUserQuizzes, deleteUserQuiz, createOrUpdateUserQuizQuestion, getUserQuizQuestions, deleteUserQuizQuestion, createOrUpdateUserQuiz, createQuizGame, updateQuizGame, getQuizzes, getTypes, getRoles, getUserRoles, updateUser, createOrUpdateUserRole, deleteUserRole, getUsers } from "../index";
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

describe("Quiz API", () => {
    describe("Account", () => {
        test("Sign In", () => {
            return quizSignIn(
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
    });

    describe("Public", () => {
        test("Get Types", () => {
            return getTypes(
                "",
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

        test("Get Roles", () => {
            return getRoles(
                "",
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

        describe("Quiz", () => {
            test("Get All", () => {
                return getQuizzes(
                    "",
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

            describe("Game", () => {
                test("Create", () => {
                    return createQuizGame(
                        "",
                        0,
                        undefined,
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

                test("Update", () => {
                    return updateQuizGame(
                        "",
                        0,
                        0,
                        undefined,
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
            });
        });
    });

    describe("User", () => {
        test("Update", () => {
            return updateUser(
                "",
                0,
                undefined,
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

        test("Get All", () => {
            return getUsers(
                "",
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

        describe("Role", () => {
            test("Create", () => {
                return createOrUpdateUserRole(
                    "",
                    0,
                    0,
                    undefined,
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

            test("Update", () => {
                return createOrUpdateUserRole(
                    "",
                    0,
                    1,
                    undefined,
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

            test("Get All", () => {
                return getUserRoles(
                    "",
                    0,
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

            test("Delete", () => {
                return deleteUserRole(
                    "",
                    0,
                    0,
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
        });

        describe("Quiz", () => {
            test("Create", () => {
                return createOrUpdateUserQuiz(
                    "",
                    0,
                    0,
                    undefined,
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

            test("Update", () => {
                return createOrUpdateUserQuiz(
                    "",
                    0,
                    1,
                    undefined,
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

            test("Get All", () => {
                return getUserQuizzes(
                    "",
                    0,
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

            test("Delete", () => {
                return deleteUserQuiz(
                    "",
                    0,
                    0,
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

            describe("Question", () => {
                test("Create", () => {
                    return createOrUpdateUserQuizQuestion(
                        "",
                        0,
                        0,
                        0,
                        undefined,
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

                test("Update", () => {
                    return createOrUpdateUserQuizQuestion(
                        "",
                        0,
                        0,
                        1,
                        undefined,
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

                test("Get All", () => {
                    return getUserQuizQuestions(
                        "",
                        0,
                        0,
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

                test("Delete", () => {
                    return deleteUserQuizQuestion(
                        "",
                        0,
                        0,
                        0,
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
            });
        });
    });

    describe("Moderator", () => {
        describe("Quiz", () => {
            test("Update", () => {
                return updateModQuiz(
                    "",
                    0,
                    undefined,
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

            test("Get All", () => {
                return getModQuizzes(
                    "",
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

            describe("Question", () => {
                test("Get All", () => {
                    return getModQuizQuestions(
                        "",
                        0,
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
            });
        });
    });
});
