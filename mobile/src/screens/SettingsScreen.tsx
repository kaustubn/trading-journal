import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  AsyncStorage,
} from 'react-native';

const SettingsScreen = ({ route }: any) => {
  const [dailyEmail, setDailyEmail] = React.useState(false);
  const [weeklyReport, setWeeklyReport] = React.useState(false);
  const { authContext } = route.params;

  const handleLogout = async () => {
    await authContext.signOut();
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>

        <View style={styles.settingItem}>
          <Text style={styles.settingLabel}>Daily Email Summary</Text>
          <Switch
            value={dailyEmail}
            onValueChange={setDailyEmail}
            trackColor={{ false: '#ddd', true: '#5a67d8' }}
          />
        </View>

        <View style={styles.settingItem}>
          <Text style={styles.settingLabel}>Weekly Report</Text>
          <Switch
            value={weeklyReport}
            onValueChange={setWeeklyReport}
            trackColor={{ false: '#ddd', true: '#5a67d8' }}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>

        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>Manage Accounts</Text>
          <Text style={styles.menuArrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>API Keys</Text>
          <Text style={styles.menuArrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>Profile Settings</Text>
          <Text style={styles.menuArrow}>→</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>

        <View style={styles.aboutItem}>
          <Text style={styles.aboutLabel}>App Version</Text>
          <Text style={styles.aboutValue}>1.0.0</Text>
        </View>

        <View style={styles.aboutItem}>
          <Text style={styles.aboutLabel}>Build</Text>
          <Text style={styles.aboutValue}>2024.01</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  section: {
    backgroundColor: 'white',
    marginVertical: 10,
    paddingVertical: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    paddingHorizontal: 15,
    paddingVertical: 10,
    color: '#333',
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  settingLabel: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  menuText: {
    fontSize: 14,
    color: '#333',
  },
  menuArrow: {
    color: '#999',
    fontSize: 16,
  },
  aboutItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  aboutLabel: {
    fontSize: 14,
    color: '#666',
  },
  aboutValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
  },
  logoutButton: {
    backgroundColor: '#ef4444',
    marginHorizontal: 10,
    marginVertical: 20,
    marginBottom: 30,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  logoutText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default SettingsScreen;
