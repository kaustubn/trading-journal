import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-community/async-storage';
import { View, ActivityIndicator } from 'react-native';

import LoginScreen from './screens/LoginScreen';
import DashboardScreen from './screens/DashboardScreen';
import TradesScreen from './screens/TradesScreen';
import AnalyticsScreen from './screens/AnalyticsScreen';
import SettingsScreen from './screens/SettingsScreen';
import TradeDetailScreen from './screens/TradeDetailScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

export default function App() {
  const [state, dispatch] = React.useReducer(
    (prevState, action) => {
      switch (action.type) {
        case 'RESTORE_TOKEN':
          return {
            ...prevState,
            userToken: action.token,
            isLoading: false,
          };
        case 'SIGN_IN':
          return {
            ...prevState,
            isSignout: false,
            userToken: action.token,
          };
        case 'SIGN_OUT':
          return {
            ...prevState,
            isSignout: true,
            userToken: null,
          };
      }
    },
    {
      isLoading: true,
      isSignout: false,
      userToken: null,
    }
  );

  useEffect(() => {
    const bootstrapAsync = async () => {
      let userToken;
      try {
        userToken = await AsyncStorage.getItem('token');
      } catch (e) {
        // Restoring token failed
      }

      dispatch({ type: 'RESTORE_TOKEN', token: userToken });
    };

    bootstrapAsync();
  }, []);

  const authContext = React.useMemo(
    () => ({
      signIn: async (email: string, password: string) => {
        try {
          const response = await fetch('http://localhost:5000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });

          const data = await response.json();
          if (data.token) {
            await AsyncStorage.setItem('token', data.token);
            dispatch({ type: 'SIGN_IN', token: data.token });
          }
          return data;
        } catch (error) {
          throw error;
        }
      },
      signOut: async () => {
        await AsyncStorage.removeItem('token');
        dispatch({ type: 'SIGN_OUT' });
      },
      signUp: async (email: string, password: string) => {
        try {
          const response = await fetch('http://localhost:5000/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });

          const data = await response.json();
          if (data.token) {
            await AsyncStorage.setItem('token', data.token);
            dispatch({ type: 'SIGN_IN', token: data.token });
          }
          return data;
        } catch (error) {
          throw error;
        }
      },
    }),
    []
  );

  if (state.isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {state.userToken == null ? (
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animationEnabled: true,
          }}
        >
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{
              animationTypeForReplace: state.isSignout ? 'pop' : 'default',
            }}
            initialParams={{ authContext }}
          />
        </Stack.Navigator>
      ) : (
        <Tab.Navigator
          screenOptions={({ route }) => ({
            tabBarActiveTintColor: '#5a67d8',
            tabBarInactiveTintColor: '#999',
            headerShown: true,
          })}
        >
          <Tab.Screen
            name="Dashboard"
            component={DashboardScreen}
            options={{
              title: 'Dashboard',
              tabBarLabel: 'Dashboard',
            }}
            initialParams={{ authContext }}
          />
          <Tab.Screen
            name="Trades"
            component={TradesScreen}
            options={{
              title: 'Trades',
              tabBarLabel: 'Trades',
            }}
            initialParams={{ authContext }}
          />
          <Tab.Screen
            name="Analytics"
            component={AnalyticsScreen}
            options={{
              title: 'Analytics',
              tabBarLabel: 'Analytics',
            }}
            initialParams={{ authContext }}
          />
          <Tab.Screen
            name="Settings"
            component={SettingsScreen}
            options={{
              title: 'Settings',
              tabBarLabel: 'Settings',
            }}
            initialParams={{ authContext }}
          />
        </Tab.Navigator>
      )}
    </NavigationContainer>
  );
}
