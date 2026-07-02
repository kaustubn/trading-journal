import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  AsyncStorage,
} from 'react-native';
import axios from 'axios';
import { format } from 'date-fns';

const TradesScreen = ({ route, navigation }: any) => {
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [token, setToken] = useState('');

  useEffect(() => {
    bootstrap();
  }, []);

  const bootstrap = async () => {
    try {
      const savedToken = await AsyncStorage.getItem('token');
      setToken(savedToken || '');
      await fetchTrades(savedToken || '');
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTrades = async (authToken: string) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const response = await axios.get('http://localhost:5000/api/trades', {
        headers: { Authorization: `Bearer ${authToken}` },
        params: { date: today, account_id: 1 },
      });
      setTrades(response.data.data || []);
    } catch (error) {
      console.error('Error fetching trades:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTrades(token);
    setRefreshing(false);
  };

  const renderTrade = ({ item }: any) => (
    <TouchableOpacity
      style={[
        styles.tradeCard,
        { borderLeftColor: item.pnl >= 0 ? '#22c55e' : '#ef4444' },
      ]}
      onPress={() => navigation.navigate('TradeDetail', { trade: item })}
    >
      <View style={styles.tradeHeader}>
        <Text style={styles.symbol}>{item.symbol}</Text>
        <Text style={[styles.pnl, { color: item.pnl >= 0 ? '#22c55e' : '#ef4444' }]}>
          ₹{item.pnl?.toFixed(2) || '0'}
        </Text>
      </View>
      <View style={styles.tradeDetails}>
        <Text style={styles.detail}>Entry: ₹{item.entry_price?.toFixed(2)}</Text>
        <Text style={styles.detail}>Exit: ₹{item.exit_price?.toFixed(2)}</Text>
        <Text style={styles.detail}>Qty: {item.quantity}</Text>
      </View>
      {item.setup_tag && (
        <Text style={styles.tag}>{item.setup_tag}</Text>
      )}
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#5a67d8" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {trades.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No trades today</Text>
        </View>
      ) : (
        <FlatList
          data={trades}
          renderItem={renderTrade}
          keyExtractor={(item) => item.id.toString()}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  listContent: {
    padding: 10,
  },
  tradeCard: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
    borderLeftWidth: 4,
  },
  tradeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  symbol: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  pnl: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  tradeDetails: {
    marginBottom: 8,
  },
  detail: {
    fontSize: 12,
    color: '#666',
    marginVertical: 2,
  },
  tag: {
    fontSize: 11,
    backgroundColor: '#f0f4ff',
    color: '#5a67d8',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
});

export default TradesScreen;
