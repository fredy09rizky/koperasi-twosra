let appInstance = null;

export const setAppInstance = (instance) => {
    appInstance = instance || null;
    return appInstance;
};

export const getAppInstance = () => appInstance;
