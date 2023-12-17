import { quizSignIn, getModQuizzes, updateModQuiz, getModQuizQuestions, getUserQuizzes, deleteUserQuiz, createOrUpdateUserQuizQuestion, getUserQuizQuestions, deleteUserQuizQuestion, createOrUpdateUserQuiz, createQuizGame, updateQuizGame, getQuizzes, getTypes, getRoles, getUserRoles, updateUser, createOrUpdateUserRole, deleteUserRole, getUsers } from "../index"

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

describe("Quiz API", () => {
    describe("Account", () => {
        test("Sign In", () => {
            return quizSignIn("", "",
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
    });

    describe("Public", () => {
        test("Get Types", () => {
            return getTypes("",
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

        test("Get Roles", () => {
            return getRoles("",
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

        describe("Quiz", () => {
            test("Get All", () => {
                return getQuizzes("",
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

            describe("Game", () => {
                test("Create", () => {
                    return createQuizGame("", 0, undefined,
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

                test("Update", () => {
                    return updateQuizGame("", 0, 0, undefined,
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
        });
    });

    describe("User", () => {
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

        describe("Role", () => {
            test("Create", () => {
                return createOrUpdateUserRole("", 0, 0, undefined,
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

            test("Update", () => {
                return createOrUpdateUserRole("", 0, 1, undefined,
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
                return getUserRoles("", 0,
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

            test("Delete", () => {
                return deleteUserRole("", 0, 0,
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

        describe("Quiz", () => {
            test("Create", () => {
                return createOrUpdateUserQuiz("", 0, 0, undefined,
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

            test("Update", () => {
                return createOrUpdateUserQuiz("", 0, 1, undefined,
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
                return getUserQuizzes("", 0,
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

            test("Delete", () => {
                return deleteUserQuiz("", 0, 0,
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

            describe("Question", () => {
                test("Create", () => {
                    return createOrUpdateUserQuizQuestion("", 0, 0, 0, undefined,
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

                test("Update", () => {
                    return createOrUpdateUserQuizQuestion("", 0, 0, 1, undefined,
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
                    return getUserQuizQuestions("", 0, 0,
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

                test("Delete", () => {
                    return deleteUserQuizQuestion("", 0, 0, 0,
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
        });
    });

    describe("Moderator", () => {
        describe("Quiz", () => {
            test("Update", () => {
                return updateModQuiz("", 0, undefined,
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
                return getModQuizzes("",
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

            describe("Question", () => {
                test("Get All", () => {
                    return getModQuizQuestions("", 0,
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
        });
    });
});
