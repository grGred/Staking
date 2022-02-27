import { ethers, network } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import Web3 from 'web3';

describe('RubicTokenStaking', function () {
    let BRBC;
    let RubicStaking;
    let signers;
    let Alice: SignerWithAddress;
    let Bob: SignerWithAddress;
    let Carol: SignerWithAddress;
    beforeEach('deploy', async function () {
        this.stakingContract = await ethers.getContractFactory('RubicTokenStaking');
        const BRBCToken = await ethers.getContractFactory('TestERC20');

        BRBC = await BRBCToken.deploy(Web3.utils.toWei('100000000', 'ether'));
        RubicStaking = await this.stakingContract.deploy(BRBC.address);

        signers = await ethers.getSigners();
        Alice = signers[1];
        Bob = signers[2];
        Carol = signers[3];

        await BRBC.mint(Alice.address, Web3.utils.toWei('100000', 'ether'));
        await BRBC.mint(Bob.address, Web3.utils.toWei('100000', 'ether'));
        await BRBC.mint(Carol.address, Web3.utils.toWei('100000', 'ether'));

        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;

        await RubicStaking.setStartDate(timestampBefore + 100);
        await network.provider.send('evm_setNextBlockTimestamp', [timestampBefore + 104]);
        await network.provider.send('evm_mine');
    });
    describe('staking tests', () => {
        it('First staker should claim all provided before rewards', async function () {
            await BRBC.connect(Carol).transfer(
                RubicStaking.address,
                Web3.utils.toWei('20', 'ether'),
                { from: Carol.address }
            );
            await BRBC.approve(RubicStaking.address, Web3.utils.toWei('10000', 'ether'));
            await RubicStaking.enter(Web3.utils.toWei('10000', 'ether'));
            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await network.provider.send('evm_mine');
            expect(
                (await RubicStaking.canReceive(Web3.utils.toWei('10000', 'ether'))).toString()
            ).to.be.eq(Web3.utils.toWei('10020', 'ether'));
        });

        it('test enterTo', async () => {
            await BRBC.approve(RubicStaking.address, Web3.utils.toWei('10000', 'ether'));
            await RubicStaking.enterTo(Web3.utils.toWei('10000', 'ether'), Alice.address);

            expect(await RubicStaking.balanceOf(Alice.address)).to.be.equal(
                Web3.utils.toWei('10000', 'ether')
            );

            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await network.provider.send('evm_mine');

            const AliceBalanceBefore = await BRBC.balanceOf(Alice.address);

            await RubicStaking.connect(Alice).leave(Web3.utils.toWei('10000', 'ether'));

            expect((await BRBC.balanceOf(Alice.address)).sub(AliceBalanceBefore)).to.be.eq(
                Web3.utils.toWei('10000', 'ether')
            );
        });

        it('should not allow withdraw more than what you have', async function () {
            await BRBC.approve(RubicStaking.address, Web3.utils.toWei('10000', 'ether'));
            await RubicStaking.enter(Web3.utils.toWei('10000', 'ether'));
            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await network.provider.send('evm_mine');
            await expect(RubicStaking.leave(Web3.utils.toWei('12000', 'ether'))).to.be.revertedWith(
                'ERC20: burn amount exceeds balance'
            );
        });

        it('should not be able to transfer xBRBC until unfreeze time', async function () {
            await BRBC.approve(RubicStaking.address, Web3.utils.toWei('10000', 'ether'));
            await RubicStaking.enter(Web3.utils.toWei('10000', 'ether'));

            await expect(RubicStaking.transfer(Bob.address, '1')).to.be.revertedWith(
                'ERC20: transfer amount exceeds balance'
            );

            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await network.provider.send('evm_mine');

            await RubicStaking.transfer(Bob.address, '1');

            expect(await RubicStaking.balanceOf(Bob.address)).to.equal('1');
        });

        it('should work with more than one participant', async function () {
            await BRBC.connect(Alice).approve(
                RubicStaking.address,
                Web3.utils.toWei('10000', 'ether')
            );
            await BRBC.connect(Bob).approve(
                RubicStaking.address,
                Web3.utils.toWei('10000', 'ether'),
                { from: Bob.address }
            );
            // Alice enters and gets 2000 shares. Bob enters and gets 1000 shares.
            await RubicStaking.connect(Alice).enter(Web3.utils.toWei('2000', 'ether'));
            await RubicStaking.connect(Bob).enter(Web3.utils.toWei('1000', 'ether'), {
                from: Bob.address
            });
            expect(await RubicStaking.balanceOf(Alice.address)).to.equal(
                Web3.utils.toWei('2000', 'ether')
            );
            expect(await RubicStaking.balanceOf(Bob.address)).to.equal(
                Web3.utils.toWei('1000', 'ether')
            );
            expect(await BRBC.balanceOf(RubicStaking.address)).to.equal(
                Web3.utils.toWei('3000', 'ether')
            );
            // stakingContract get 3000 more BRBCs from an external source.
            await BRBC.connect(Carol).transfer(
                RubicStaking.address,
                Web3.utils.toWei('3000', 'ether'),
                { from: Carol.address }
            );
            // Alice deposits 1000 more BRBCs. She should receive 1000*3000/6000 = 500 shares.
            await RubicStaking.connect(Alice).enter(Web3.utils.toWei('1000', 'ether'));
            expect(await RubicStaking.balanceOf(Alice.address)).to.equal(
                Web3.utils.toWei('2500', 'ether')
            );
            expect(await RubicStaking.balanceOf(Bob.address)).to.equal(
                Web3.utils.toWei('1000', 'ether')
            );
            // Bob withdraws 500 shares. He should receive 500*7000/3500 = 1000 tokens
            expect(await RubicStaking.canReceive(Web3.utils.toWei('500', 'ether'))).to.be.eq(
                Web3.utils.toWei('1000', 'ether')
            );
            await expect(
                RubicStaking.connect(Bob).leave(Web3.utils.toWei('500', 'ether'), {
                    from: Bob.address
                })
            ).to.be.revertedWith('ERC20: burn amount exceeds balance');
            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await network.provider.send('evm_mine');
            await RubicStaking.connect(Bob).leave(Web3.utils.toWei('500', 'ether'), {
                from: Bob.address
            });
            expect(await RubicStaking.canReceive(Web3.utils.toWei('500', 'ether'))).to.be.eq(
                Web3.utils.toWei('1000', 'ether')
            );
            expect(await RubicStaking.balanceOf(Alice.address)).to.equal(
                Web3.utils.toWei('2500', 'ether')
            );
            expect(await RubicStaking.canReceive(Web3.utils.toWei('2500', 'ether'))).to.be.eq(
                Web3.utils.toWei('5000', 'ether')
            );
            expect(await RubicStaking.balanceOf(Bob.address)).to.equal(
                Web3.utils.toWei('500', 'ether')
            );
            expect(await BRBC.balanceOf(RubicStaking.address)).to.equal(
                Web3.utils.toWei('6000', 'ether')
            );
            expect(await BRBC.balanceOf(Alice.address)).to.equal(
                Web3.utils.toWei('97000', 'ether')
            );
            expect(await BRBC.balanceOf(Bob.address)).to.equal(Web3.utils.toWei('100000', 'ether'));
        });
    });

    describe('utility', () => {
        it('should not allow enter if not enough approve', async function () {
            await expect(
                RubicStaking.connect(Alice).enter(Web3.utils.toWei('10000', 'ether'))
            ).to.be.revertedWith('allowance insufficient');
            await BRBC.connect(Alice).approve(RubicStaking.address, '50');
            await expect(
                RubicStaking.connect(Alice).enter(Web3.utils.toWei('10000', 'ether'))
            ).to.be.revertedWith('allowance insufficient');
            await BRBC.connect(Alice).approve(
                RubicStaking.address,
                Web3.utils.toWei('10000', 'ether')
            );
            await RubicStaking.connect(Alice).enter(Web3.utils.toWei('10000', 'ether'));
            expect(await RubicStaking.balanceOf(Alice.address)).to.equal(
                Web3.utils.toWei('10000', 'ether')
            );
        });
        it('should display available tokens', async () => {
            await BRBC.approve(RubicStaking.address, Web3.utils.toWei('10000', 'ether'));
            await RubicStaking.enter(Web3.utils.toWei('10000', 'ether'));
            expect((await RubicStaking.actualBalanceOf(signers[0].address)).toString()).to.be.eq(
                '0'
            );
            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await network.provider.send('evm_mine');
            expect((await RubicStaking.actualBalanceOf(signers[0].address)).toString()).to.be.eq(
                Web3.utils.toWei('10000', 'ether')
            );
            expect((await RubicStaking.balanceOf(signers[0].address)).toString()).to.be.eq(
                Web3.utils.toWei('10000', 'ether')
            );
            expect((await RubicStaking.freezingBalanceOf(signers[0].address)).toString()).to.be.eq(
                Web3.utils.toWei('10000', 'ether')
            );
            expect(
                (await RubicStaking.canReceive(Web3.utils.toWei('10000', 'ether'))).toString()
            ).to.be.eq(Web3.utils.toWei('10000', 'ether'));
        });
        it('cant stake before start time', async () => {
            await RubicStaking.setStartDate('1738369056');
            expect(RubicStaking.enter('100')).to.be.revertedWith('hasnt started yet');
        });
        it('cant stake more than user limit', async () => {
            expect(RubicStaking.enter('100001' + '0'.repeat(18))).to.be.revertedWith(
                'more than limit per user'
            );
        });
        it('cant stake more than total limit', async () => {
            for (let i = 0; i < 70; i++) {
                await BRBC.mint(signers[i].address, '100000' + '0'.repeat(18));
                await BRBC.connect(signers[i]).approve(
                    RubicStaking.address,
                    '10000000000000000' + '0'.repeat(18)
                );
                await RubicStaking.connect(signers[i]).enter('100000' + '0'.repeat(18));
            }
            expect(
                RubicStaking.connect(signers[71]).enter('100000' + '0'.repeat(18))
            ).to.be.revertedWith('more than total limit');
        });
        it('can decrease total limit and increase again', async () => {
            for (let i = 0; i < 70; i++) {
                await BRBC.mint(signers[i].address, '100000' + '0'.repeat(18));
                await BRBC.connect(signers[i]).approve(
                    RubicStaking.address,
                    '10000000000000000' + '0'.repeat(18)
                );
                await RubicStaking.connect(signers[i]).enter('100000' + '0'.repeat(18));
            }
            await BRBC.mint(signers[71].address, '100000' + '0'.repeat(18));
            expect(
                RubicStaking.connect(signers[71]).enter('100000' + '0'.repeat(18))
            ).to.be.revertedWith('more than total limit');
            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await network.provider.send('evm_mine');
            await RubicStaking.leave('100000' + '0'.repeat(18));
            await BRBC.connect(signers[71]).approve(
                RubicStaking.address,
                '10000000000000000' + '0'.repeat(18)
            );
            await expect(
                RubicStaking.connect(signers[71]).enter('100000' + '0'.repeat(18))
            ).to.be.revertedWith('more than total limit');
        });
        it('sweep tokens test', async () => {
            const TestTokenFactory = await ethers.getContractFactory('TestERC20');
            const TestToken = await TestTokenFactory.deploy('100');

            await TestToken.transfer(RubicStaking.address, '100');
            expect(await TestToken.balanceOf(signers[0].address)).to.be.eq('0');
            await expect(RubicStaking.sweepTokens(BRBC.address)).to.be.revertedWith(
                'cant sweep BRBC'
            );
            await RubicStaking.sweepTokens(TestToken.address);
            expect(await TestToken.balanceOf(signers[0].address)).to.be.eq('100');
        });
    });
});