import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';

const LoginScreen = ({ route }: any) => {
  const [email, setEmail] = useState('demo@example.com');
  const [password, setPassword] = useState('demo123');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const { authContext } = route.params;

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await authContext.signIn(email, password);
      } else {
        await authContext.signUp(email, password);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Trading Journal</Text>
        <Text style={styles.subtitle}>Mobile Edition</Text>
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          editable={!loading}
          keyboardType="email-address"
          placeholderTextColor="#999"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
          placeholderTextColor="#999"
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleAuth}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.buttonText}>
              {mode === 'login' ? 'Login' : 'Register'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setMode(mode === 'login' ? 'register' : 'login')}
          disabled={loading}
        >
          <Text style={styles.toggleText}>
            {mode === 'login'
              ? "Don't have an account? Register"
              : 'Already have an account? Login'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.demo}>
        <Text style={styles.demoLabel}>Demo Credentials:</Text>
        <Text style={styles.demoText}>Email: demo@example.com</Text>
        <Text style={styles.demoText}>Password: demo123</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#999',
    marginTop: 5,
  },
  form: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 8,
    marginBottom: 30,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    marginBottom: 15,
    borderRadius: 6,
    fontSize: 16,
    color: '#333',
  },
  button: {
    backgroundColor: '#5a67d8',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 15,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  toggleText: {
    color: '#5a67d8',
    textAlign: 'center',
    fontSize: 14,
  },
  demo: {
    backgroundColor: '#f0f4ff',
    padding: 15,
    borderRadius: 6,
  },
  demoLabel: {
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  demoText: {
    color: '#666',
    fontSize: 13,
  },
});

export default LoginScreen;
